/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly MAIN_VITE_NOTION_CLIENT_ID: string
  readonly MAIN_VITE_NOTION_CLIENT_SECRET: string
  readonly MAIN_VITE_ANTHROPIC_KEY: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
