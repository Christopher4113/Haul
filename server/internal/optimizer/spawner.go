package optimizer

import (
	"bytes"
	"context"
	_ "embed"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"

	batchv1 "k8s.io/api/batch/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
	"sigs.k8s.io/yaml"
)

//go:embed job-template.yaml
var embeddedJobTemplate []byte

func SpawnOptimizerJob(routeID string) error {
	if routeID == "" {
		return fmt.Errorf("route id is required")
	}

	template, err := loadJobTemplate()
	if err != nil {
		return err
	}

	rendered := bytes.ReplaceAll(template, []byte("{{ROUTE_ID}}"), []byte(routeID))

	var job batchv1.Job
	if err := yaml.Unmarshal(rendered, &job); err != nil {
		return fmt.Errorf("unmarshal job template: %w", err)
	}

	config, err := restConfig()
	if err != nil {
		return err
	}

	clientset, err := kubernetes.NewForConfig(config)
	if err != nil {
		return fmt.Errorf("create kubernetes client: %w", err)
	}

	_, err = clientset.BatchV1().Jobs(job.Namespace).Create(
		context.Background(),
		&job,
		metav1.CreateOptions{},
	)
	if err != nil {
		return fmt.Errorf("create optimizer job: %w", err)
	}

	log.Printf("spawned optimizer job %s in namespace %s", job.Name, job.Namespace)
	return nil
}

func restConfig() (*rest.Config, error) {
	config, err := rest.InClusterConfig()
	if err == nil {
		return config, nil
	}

	kubeconfig := os.Getenv("KUBECONFIG")
	if kubeconfig == "" {
		home, homeErr := os.UserHomeDir()
		if homeErr != nil {
			return nil, fmt.Errorf("resolve kubeconfig: %w", homeErr)
		}
		kubeconfig = filepath.Join(home, ".kube", "config")
	}

	config, err = clientcmd.BuildConfigFromFlags("", kubeconfig)
	if err != nil {
		return nil, fmt.Errorf("build kubeconfig from %s: %w", kubeconfig, err)
	}

	return config, nil
}

func loadJobTemplate() ([]byte, error) {
	if customPath := strings.TrimSpace(os.Getenv("OPTIMIZER_JOB_TEMPLATE")); customPath != "" {
		content, err := os.ReadFile(customPath)
		if err != nil {
			return nil, fmt.Errorf("read OPTIMIZER_JOB_TEMPLATE: %w", err)
		}
		return content, nil
	}

	candidates := []string{
		"k8s/optimizer-job-template.yaml",
		filepath.Join("..", "..", "k8s", "optimizer-job-template.yaml"),
	}
	for _, candidate := range candidates {
		content, err := os.ReadFile(candidate)
		if err == nil {
			return content, nil
		}
	}

	return embeddedJobTemplate, nil
}
