export interface SettingRow {
  key: string;
  value: string;
}

export interface OllamaHealth {
  reachable: boolean;
  version?: string;
  host: string;
  errorMessage?: string;
}
