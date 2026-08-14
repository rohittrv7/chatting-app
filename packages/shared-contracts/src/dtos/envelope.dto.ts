export class ApiResponseEnvelope<T = unknown> {
  success!: boolean;
  message!: string;
  data?: T;
  timestamp!: string;
}

export class ApiErrorEnvelope {
  success: false = false;
  code!: string;
  message!: string;
  details?: Record<string, unknown>;
}
