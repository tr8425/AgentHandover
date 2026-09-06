import fs from 'fs'
import path from 'path'
import os from 'os'

const CONFIG_DIR = path.join(os.homedir(), '.config', 'agent-cli')
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json')

export interface Config {
  apiKey: string
  claudeDir: string
  defaultMode: 'personal' | 'team'
}

export function loadConfig(): Partial<Config> {
  // 환경변수 우선
  const envKey = process.env.ANTHROPIC_API_KEY
  if (envKey) {
    return { apiKey: envKey }
  }

  if (!fs.existsSync(CONFIG_FILE)) return {}

  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'))
  } catch {
    return {}
  }
}

export function saveConfig(config: Partial<Config>): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true })
  const existing = loadConfig()
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ ...existing, ...config }, null, 2))
}

export function getCacheDir(): string {
  const dir = path.join(os.homedir(), '.cache', 'agent-cli')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}
