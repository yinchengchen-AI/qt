export type BusinessReportSource = "AI" | "LOCAL";

export type AnalysisReport = {
  summary: string;
  keyFindings: string[];
  recommendations: string[];
  generatedAt: string;
  source: BusinessReportSource;
  model: string | null;
  cached: boolean;
  notice: string | null;
};
