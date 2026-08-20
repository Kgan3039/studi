export type ReportSubmitGuard = {
  acquire(): boolean;
  markSubmitted(): void;
  releaseAfterFailure(): void;
};

export function createReportSubmitGuard(): ReportSubmitGuard;
