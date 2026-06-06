package mailer

import (
	"crypto/tls"
	"fmt"
	"net"
	"net/smtp"
	"strings"
)

type Config struct {
	Host      string
	Port      string
	Username  string
	Password  string
	From      string
	ClientURL string
}

type Mailer struct {
	cfg Config
}

func New(cfg Config) *Mailer {
	if cfg.Host == "" {
		cfg.Host = "smtp.gmail.com"
	}
	if cfg.Port == "" {
		cfg.Port = "465"
	}
	if cfg.From == "" {
		cfg.From = cfg.Username
	}
	cfg.ClientURL = strings.TrimRight(cfg.ClientURL, "/")

	return &Mailer{cfg: cfg}
}

func (m *Mailer) Configured() bool {
	return m.cfg.Username != "" && m.cfg.Password != ""
}

func (m *Mailer) SendPasswordReset(toEmail, token string) error {
	resetURL := fmt.Sprintf("%s/reset-password?token=%s", m.cfg.ClientURL, token)

	subject := "Reset your Haul password"
	body := fmt.Sprintf(`<!DOCTYPE html>
<html>
<body style="font-family: sans-serif; color: #1c1917; line-height: 1.6;">
  <p>Hello,</p>
  <p>We received a request to reset your Haul password.</p>
  <p><a href="%[1]s">Click here to reset your password</a></p>
  <p>Or copy and paste this link into your browser:</p>
  <p><a href="%[1]s">%[1]s</a></p>
  <p>This link expires in one hour. If you did not request a reset, you can ignore this email.</p>
</body>
</html>`, resetURL)

	return m.send(toEmail, subject, body)
}

func (m *Mailer) send(to, subject, htmlBody string) error {
	from := m.cfg.From
	addr := net.JoinHostPort(m.cfg.Host, m.cfg.Port)
	auth := smtp.PlainAuth("", m.cfg.Username, m.cfg.Password, m.cfg.Host)
	message := buildMessage(from, to, subject, htmlBody)

	if m.cfg.Port == "465" {
		return sendMailTLS(addr, m.cfg.Host, auth, from, []string{to}, message)
	}

	return smtp.SendMail(addr, auth, from, []string{to}, message)
}

func buildMessage(from, to, subject, htmlBody string) []byte {
	headers := []string{
		fmt.Sprintf("From: %s", from),
		fmt.Sprintf("To: %s", to),
		fmt.Sprintf("Subject: %s", subject),
		"MIME-Version: 1.0",
		"Content-Type: text/html; charset=UTF-8",
	}
	return []byte(strings.Join(headers, "\r\n") + "\r\n\r\n" + htmlBody)
}

func sendMailTLS(addr, host string, auth smtp.Auth, from string, to []string, msg []byte) error {
	conn, err := tls.Dial("tcp", addr, &tls.Config{
		ServerName: host,
		MinVersion: tls.VersionTLS12,
	})
	if err != nil {
		return err
	}
	defer conn.Close()

	client, err := smtp.NewClient(conn, host)
	if err != nil {
		return err
	}
	defer client.Close()

	if auth != nil {
		if err := client.Auth(auth); err != nil {
			return err
		}
	}

	if err := client.Mail(from); err != nil {
		return err
	}

	for _, recipient := range to {
		if err := client.Rcpt(recipient); err != nil {
			return err
		}
	}

	writer, err := client.Data()
	if err != nil {
		return err
	}

	if _, err := writer.Write(msg); err != nil {
		return err
	}

	if err := writer.Close(); err != nil {
		return err
	}

	return client.Quit()
}
