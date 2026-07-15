// Types for Built-in AI (Summary Models) integration
export interface BuiltInModelInfo {
  name: string;
  display_name: string;
  status: BuiltInModelStatus;
  path: string;
  size_mb: number;
  context_size: number;
  description: string;
  gguf_file: string;
}

export type BuiltInModelStatus =
  | { type: "not_downloaded" }
  | { type: "downloading"; progress: number }
  | { type: "available" }
  | { type: "corrupted"; file_size: number; expected_min_size: number }
  | { type: "error"; Error: string };
