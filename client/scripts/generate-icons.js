import { createCanvas } from "canvas"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const publicDir = path.resolve(__dirname, "../public")

function generateIcon(size) {
  const canvas = createCanvas(size, size)
  const ctx = canvas.getContext("2d")
  ctx.fillStyle = "#09090b"
  ctx.fillRect(0, 0, size, size)
  ctx.fillStyle = "#F59E0B"
  ctx.font = `bold ${size * 0.55}px sans-serif`
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  ctx.fillText("H", size / 2, size / 2)
  return canvas.toBuffer("image/png")
}

const iconsDir = path.join(publicDir, "icons")
fs.mkdirSync(iconsDir, { recursive: true })

const icon192 = generateIcon(192)
const icon512 = generateIcon(512)

fs.writeFileSync(path.join(iconsDir, "icon-192.png"), icon192)
fs.writeFileSync(path.join(iconsDir, "icon-512.png"), icon512)
fs.writeFileSync(path.join(publicDir, "apple-touch-icon.png"), icon192)

console.log("Icons generated.")
