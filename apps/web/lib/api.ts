import type {
  AdjustmentDirection,
  AdjustmentListItem,
  AdjustmentReasonResponse,
  AdjustmentResponse,
  AuditEntryResponse,
  AuditPage,
  AuditFilter,
  SearchResult,
  ImportPreviewResponse,
  ImportJobResponse,
  ReservationResponse,
  ReservedBreakdownRow,
  ReturnResponse,
  QuarantineBreakdownRow,
  LotResponse,
  LotMovementRow,
  PickableLot,
  ExpiryDashboardRow,
  LotExpiryFactResponse,
  AllocationPlan,
  AuthenticatedUser,
  AuthTokenResponse,
  BalanceResponse,
  BarcodeResolutionResult,
  ScanDiagnosis,
  BarcodeResponse,
  BarcodeType,
  BrandResponse,
  CategoryResponse,
  EntityStatus,
  UnitConversionResponse,
  UnitResponse,
  VariantResponse,
  CountListItem,
  CountResponse,
  CountType,
  DashboardSummary,
  DeadStockRow,
  InventoryPolicyResponse,
  ReorderAssessment,
  ReorderState,
  ValuationGrouping,
  ValuationReport,
  LoginRequest,
  OrganizationResponse,
  ProductResponse,
  ReceiptListItem,
  ReceiptResponse,
  RegisterOrganizationRequest,
  ReleaseDestinationType,
  ReleaseListItem,
  ReleaseResponse,
  SupplierResponse,
  SupplierProductResponse,
  TransferListItem,
  TransferResponse,
  WarehouseResponse,
  WarehouseLocationResponse,
  LocationUsage,
  CycleCountMetrics,
  CycleCountTaskResponse,
  CycleCountCoverageRow,
  CycleCountPolicyResponse,
  ProductClassificationRow,
  MembershipUserResponse,
  InventoryPositionRow,
  OutboxHealthResponse,
  OutboxEventListItem,
  NotificationResponse,
  UnreadCountResponse,
  NotificationPreferenceResponse,
  OrganizationWebhookConfigResponse,
  NotificationDeliveryListItem,
  SerialResponse,
  SerialStatus,
  SerialTrackingPolicyResponse,
  SerialReconciliationResult,
  SerialHistoryResponse,
  MobileWorkItem,
  MobileWorkClaim,
  MobileWorkType,
  SupplierPerformanceResponse,
  SupplierAnalyticsPolicyResponse,
  SupplierScorecardResponse,
  PreferredSupplierComparisonResponse,
  SupplierTrendSeriesResponse,
  SupplierEvidenceResponse,
  EvidenceMetric,
  CostingPolicyResponse,
  CostLayerResponse,
  CostValuationRow,
  CostingStrategy,
  FifoCogsReportResponse,
  CostLayerTraceResponse,
  MovementCostDetailResponse,
  TransferCostTraceResponse,
  ReturnCostTraceResponse,
} from '@iw/contracts';

export interface CreateTransferBody {
  sourceWarehouseId: string;
  destWarehouseId: string;
  reference?: string;
  notes?: string;
  items: Array<{ productId: string; quantity: number }>;
}

export interface CreateAdjustmentBody {
  warehouseId: string;
  reasonId?: string;
  notes?: string;
  items: Array<{ productId: string; direction: AdjustmentDirection; quantity: number; unitCost?: number }>;
}

export interface CreateReleaseBody {
  warehouseId: string;
  destinationType: ReleaseDestinationType;
  purpose?: string;
  destinationRef?: string;
  reference?: string;
  notes?: string;
  items: Array<{ productId: string; requestedQty: number; reservationLineId?: string; allocations?: Array<{ lotId: string; quantity: number }> }>;
}

export interface CreateReceiptBody {
  supplierId?: string;
  warehouseId: string;
  purchaseOrderRef?: string;
  orderDate?: string;
  expectedDeliveryDate?: string;
  notes?: string;
  items: Array<{
    productId: string;
    expectedQty?: number;
    receivedQty?: number;
    unitCost?: number;
    batchNumber?: string;
    locationId?: string;
    serialNumbers?: string[];
  }>;
}

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4100';
const TOKEN_KEY = 'iw_token';
const REFRESH_KEY = 'iw_refresh';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  try { return window.localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
function getRefreshToken(): string | null {
  if (typeof window === 'undefined') return null;
  try { return window.localStorage.getItem(REFRESH_KEY); } catch { return null; }
}

/** Store the access token only (kept for callers that pass a single token). */
export function setToken(token: string): void {
  try { window.localStorage.setItem(TOKEN_KEY, token); } catch { /* ignore */ }
}

/** Store both tokens from an auth response. */
export function setTokens(accessToken: string, refreshToken: string): void {
  try {
    window.localStorage.setItem(TOKEN_KEY, accessToken);
    window.localStorage.setItem(REFRESH_KEY, refreshToken);
  } catch { /* ignore */ }
}

export function clearToken(): void {
  try {
    window.localStorage.removeItem(TOKEN_KEY);
    window.localStorage.removeItem(REFRESH_KEY);
  } catch { /* ignore */ }
}

// Single-flight refresh: concurrent 401s share one rotation so the token isn't reused twice.
let refreshInFlight: Promise<boolean> | null = null;

async function refreshAccessToken(): Promise<boolean> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const res = await fetch(`${API_URL}/api/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        });
        if (!res.ok) { clearToken(); return false; }
        const body = (await res.json()) as { accessToken: string; refreshToken: string };
        setTokens(body.accessToken, body.refreshToken);
        return true;
      } catch {
        return false;
      } finally {
        refreshInFlight = null;
      }
    })();
  }
  return refreshInFlight;
}

async function rawFetch(path: string, init: RequestInit): Promise<Response> {
  const token = getToken();
  return fetch(`${API_URL}/api${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res = await rawFetch(path, init);

  // Access tokens are short-lived; on a 401 try one silent refresh + retry (except on auth calls).
  if (res.status === 401 && !path.startsWith('/auth/')) {
    if (await refreshAccessToken()) {
      res = await rawFetch(path, init);
    }
  }

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.message) message = Array.isArray(body.message) ? body.message.join(', ') : body.message;
    } catch {
      /* keep default */
    }
    throw new Error(message);
  }
  if (res.status === 204 || res.headers.get('content-length') === '0') {
    return undefined as T;
  }
  return (await res.json()) as T;
}

/** Fetch a CSV with auth (a plain <a> can't send the bearer token) and save it via a Blob URL. */
async function downloadCsv(path: string, filename: string): Promise<void> {
  const token = getToken();
  const res = await fetch(`${API_URL}/api${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) {
    let message = `Export failed (${res.status})`;
    try { const b = await res.json(); if (b?.message) message = Array.isArray(b.message) ? b.message.join(', ') : b.message; } catch { /* keep */ }
    throw new Error(message);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

export const api = {
  register: (body: RegisterOrganizationRequest) =>
    request<AuthTokenResponse>('/auth/register', { method: 'POST', body: JSON.stringify(body) }),
  login: (body: LoginRequest) =>
    request<AuthTokenResponse>('/auth/login', { method: 'POST', body: JSON.stringify(body) }),
  me: () => request<AuthenticatedUser>('/auth/me'),
  logout: () => request<void>('/auth/logout', { method: 'POST' }),
  currentOrganization: () => request<OrganizationResponse>('/organizations/current'),

  products: (status?: EntityStatus) => request<ProductResponse[]>(`/products${status ? `?status=${status}` : ''}`),
  warehouses: (q?: string, status?: EntityStatus) => request<WarehouseResponse[]>(`/warehouses${catalogQs(q, status)}`),
  suppliers: (q?: string, status?: EntityStatus) => request<SupplierResponse[]>(`/suppliers${catalogQs(q, status)}`),
  balances: (params?: { warehouseId?: string; productId?: string }) => {
    const q = new URLSearchParams();
    if (params?.warehouseId) q.set('warehouseId', params.warehouseId);
    if (params?.productId) q.set('productId', params.productId);
    const qs = q.toString();
    return request<BalanceResponse[]>(`/inventory/balances${qs ? `?${qs}` : ''}`);
  },
  supplierPerformance: (filters: Record<string, string> = {}) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) if (v) q.set(k, v);
    const qs = q.toString();
    return request<SupplierPerformanceResponse>(`/analytics/suppliers${qs ? `?${qs}` : ''}`);
  },
  supplierScorecard: (id: string, filters: Record<string, string> = {}) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) if (v) q.set(k, v);
    const qs = q.toString();
    return request<SupplierScorecardResponse>(`/analytics/suppliers/${id}/scorecard${qs ? `?${qs}` : ''}`);
  },
  preferredSupplierComparison: (filters: Record<string, string> = {}) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) if (v) q.set(k, v);
    const qs = q.toString();
    return request<PreferredSupplierComparisonResponse>(`/analytics/suppliers/preferred-comparison${qs ? `?${qs}` : ''}`);
  },
  supplierTrends: (id: string, filters: Record<string, string> = {}) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) if (v) q.set(k, v);
    const qs = q.toString();
    return request<SupplierTrendSeriesResponse>(`/analytics/suppliers/${id}/trends${qs ? `?${qs}` : ''}`);
  },
  supplierEvidence: (id: string, metric: EvidenceMetric, filters: Record<string, string> = {}) => {
    const q = new URLSearchParams({ metric });
    for (const [k, v] of Object.entries(filters)) if (v) q.set(k, v);
    return request<SupplierEvidenceResponse>(`/analytics/suppliers/${id}/evidence?${q.toString()}`);
  },
  supplierWeights: () => request<SupplierAnalyticsPolicyResponse>('/analytics/suppliers/policy'),
  saveSupplierWeights: (w: { fillRate: number; onTime: number; leadTime: number; price: number; quality: number }) =>
    request<SupplierAnalyticsPolicyResponse>('/analytics/suppliers/policy', { method: 'PUT', body: JSON.stringify(w) }),
  costingPolicy: (productId?: string) => request<CostingPolicyResponse>(`/inventory/costing-policy${productId ? `?productId=${productId}` : ''}`),
  setCostingPolicy: (strategy: CostingStrategy, productId?: string) =>
    request<CostingPolicyResponse>('/inventory/costing-policy', { method: 'POST', body: JSON.stringify({ strategy, ...(productId ? { productId } : {}) }) }),
  costLayers: (filters: Record<string, string> = {}) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) if (v) q.set(k, v);
    const qs = q.toString();
    return request<CostLayerResponse[]>(`/inventory/cost-layers${qs ? `?${qs}` : ''}`);
  },
  costValuation: (filters: Record<string, string> = {}) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) if (v) q.set(k, v);
    const qs = q.toString();
    return request<CostValuationRow[]>(`/inventory/cost-valuation${qs ? `?${qs}` : ''}`);
  },
  costLayerTrace: (id: string) => request<CostLayerTraceResponse>(`/inventory/cost-layers/${id}/trace`),
  movementCostDetail: (id: string) => request<MovementCostDetailResponse>(`/inventory/movements/${id}/cost-detail`),
  transferCostTrace: (id: string) => request<TransferCostTraceResponse>(`/inventory/transfers/${id}/cost-trace`),
  returnCostTrace: (id: string) => request<ReturnCostTraceResponse>(`/inventory/returns/${id}/cost-trace`),
  fifoCogs: (filters: Record<string, string> = {}) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) if (v) q.set(k, v);
    const qs = q.toString();
    return request<FifoCogsReportResponse>(`/inventory/fifo-cogs${qs ? `?${qs}` : ''}`);
  },
  positions: (filters: Record<string, string> = {}) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) if (v) q.set(k, v);
    const qs = q.toString();
    return request<InventoryPositionRow[]>(`/inventory/positions${qs ? `?${qs}` : ''}`);
  },

  receiving: {
    list: () => request<ReceiptListItem[]>('/receiving'),
    get: (id: string) => request<ReceiptResponse>(`/receiving/${id}`),
    create: (body: CreateReceiptBody) =>
      request<ReceiptResponse>('/receiving', { method: 'POST', body: JSON.stringify(body) }),
    post: (id: string) => request<ReceiptResponse>(`/receiving/${id}/post`, { method: 'POST' }),
    cancel: (id: string) => request<ReceiptResponse>(`/receiving/${id}/cancel`, { method: 'POST' }),
  },

  releases: {
    list: () => request<ReleaseListItem[]>('/releases'),
    get: (id: string) => request<ReleaseResponse>(`/releases/${id}`),
    create: (body: CreateReleaseBody) =>
      request<ReleaseResponse>('/releases', { method: 'POST', body: JSON.stringify(body) }),
    submit: (id: string) => request<ReleaseResponse>(`/releases/${id}/submit`, { method: 'POST' }),
    approve: (id: string) =>
      request<ReleaseResponse>(`/releases/${id}/approve`, { method: 'POST', body: JSON.stringify({}) }),
    reject: (id: string, reason: string) =>
      request<ReleaseResponse>(`/releases/${id}/reject`, { method: 'POST', body: JSON.stringify({ reason }) }),
    post: (id: string, fefoOverrideReason?: string, serials?: Array<{ itemId: string; serialNumbers: string[] }>) =>
      request<ReleaseResponse>(`/releases/${id}/post`, { method: 'POST', body: JSON.stringify({ ...(fefoOverrideReason ? { fefoOverrideReason } : {}), ...(serials && serials.length ? { serials } : {}) }) }),
    cancel: (id: string) => request<ReleaseResponse>(`/releases/${id}/cancel`, { method: 'POST' }),
  },

  transfers: {
    list: () => request<TransferListItem[]>('/transfers'),
    get: (id: string) => request<TransferResponse>(`/transfers/${id}`),
    create: (body: CreateTransferBody) =>
      request<TransferResponse>('/transfers', { method: 'POST', body: JSON.stringify(body) }),
    submit: (id: string) => request<TransferResponse>(`/transfers/${id}/submit`, { method: 'POST' }),
    approve: (id: string) => request<TransferResponse>(`/transfers/${id}/approve`, { method: 'POST' }),
    reject: (id: string, reason: string) =>
      request<TransferResponse>(`/transfers/${id}/reject`, { method: 'POST', body: JSON.stringify({ reason }) }),
    dispatch: (id: string, serials?: Array<{ itemId: string; serialNumbers: string[] }>) =>
      request<TransferResponse>(`/transfers/${id}/dispatch`, { method: 'POST', body: JSON.stringify(serials && serials.length ? { serials } : {}) }),
    receive: (id: string) => request<TransferResponse>(`/transfers/${id}/receive`, { method: 'POST' }),
    cancel: (id: string) => request<TransferResponse>(`/transfers/${id}/cancel`, { method: 'POST' }),
  },

  adjustments: {
    list: () => request<AdjustmentListItem[]>('/adjustments'),
    get: (id: string) => request<AdjustmentResponse>(`/adjustments/${id}`),
    create: (body: CreateAdjustmentBody) =>
      request<AdjustmentResponse>('/adjustments', { method: 'POST', body: JSON.stringify(body) }),
    submit: (id: string) => request<AdjustmentResponse>(`/adjustments/${id}/submit`, { method: 'POST' }),
    approve: (id: string) => request<AdjustmentResponse>(`/adjustments/${id}/approve`, { method: 'POST' }),
    secondApprove: (id: string) => request<AdjustmentResponse>(`/adjustments/${id}/second-approve`, { method: 'POST' }),
    reject: (id: string, reason: string) =>
      request<AdjustmentResponse>(`/adjustments/${id}/reject`, { method: 'POST', body: JSON.stringify({ reason }) }),
    post: (id: string) => request<AdjustmentResponse>(`/adjustments/${id}/post`, { method: 'POST' }),
    cancel: (id: string) => request<AdjustmentResponse>(`/adjustments/${id}/cancel`, { method: 'POST' }),
  },

  adjustmentReasons: {
    list: () => request<AdjustmentReasonResponse[]>('/adjustment-reasons'),
    create: (body: { code: string; name: string; requiresEvidence?: boolean }) =>
      request<AdjustmentReasonResponse>('/adjustment-reasons', { method: 'POST', body: JSON.stringify(body) }),
    update: (id: string, body: { name?: string; isActive?: boolean }) =>
      request<AdjustmentReasonResponse>(`/adjustment-reasons/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  },

  counts: {
    list: () => request<CountListItem[]>('/counts'),
    get: (id: string) => request<CountResponse>(`/counts/${id}`),
    create: (body: { warehouseId: string; type?: CountType; isBlind?: boolean; notes?: string }) =>
      request<CountResponse>('/counts', { method: 'POST', body: JSON.stringify(body) }),
    enter: (id: string, items: Array<{ itemId: string; countedQty: number }>) =>
      request<CountResponse>(`/counts/${id}/entries`, { method: 'POST', body: JSON.stringify({ items }) }),
    submit: (id: string) => request<CountResponse>(`/counts/${id}/submit`, { method: 'POST' }),
    approve: (id: string) => request<CountResponse>(`/counts/${id}/approve`, { method: 'POST' }),
    post: (id: string) => request<CountResponse>(`/counts/${id}/post`, { method: 'POST' }),
    cancel: (id: string) => request<CountResponse>(`/counts/${id}/cancel`, { method: 'POST' }),
  },

  cycleCount: {
    metrics: (warehouseId?: string, from?: string, to?: string) => {
      const p = new URLSearchParams();
      if (warehouseId) p.set('warehouseId', warehouseId);
      if (from) p.set('from', from);
      if (to) p.set('to', to);
      const qs = p.toString();
      return request<CycleCountMetrics>(`/cycle-count/metrics${qs ? `?${qs}` : ''}`);
    },
    tasks: (filters: Record<string, string> = {}) => {
      const p = new URLSearchParams();
      for (const [k, v] of Object.entries(filters)) if (v) p.set(k, v);
      const qs = p.toString();
      return request<CycleCountTaskResponse[]>(`/cycle-count/tasks${qs ? `?${qs}` : ''}`);
    },
    task: (id: string) => request<CycleCountTaskResponse>(`/cycle-count/tasks/${id}`),
    coverage: (warehouseId: string, dueOnly = false) =>
      request<CycleCountCoverageRow[]>(`/cycle-count/coverage?warehouseId=${warehouseId}${dueOnly ? '&dueOnly=true' : ''}`),
    policy: (warehouseId?: string) => request<CycleCountPolicyResponse>(`/cycle-count/policy${warehouseId ? `?warehouseId=${warehouseId}` : ''}`),
    savePolicy: (body: Record<string, unknown>) =>
      request<CycleCountPolicyResponse>('/cycle-count/policy', { method: 'PUT', body: JSON.stringify(body) }),
    classify: (warehouseId: string, strategy?: string) =>
      request<ProductClassificationRow[]>('/cycle-count/classify', { method: 'POST', body: JSON.stringify({ warehouseId, ...(strategy ? { strategy } : {}) }) }),
    setClassification: (warehouseId: string, productId: string, abcClass: string, variantId?: string) =>
      request<ProductClassificationRow>('/cycle-count/classification', { method: 'PUT', body: JSON.stringify({ warehouseId, productId, abcClass, ...(variantId ? { variantId } : {}) }) }),
    generate: (warehouseId: string) =>
      request<CycleCountTaskResponse[]>('/cycle-count/generate', { method: 'POST', body: JSON.stringify({ warehouseId }) }),
    createAdHoc: (body: { warehouseId: string; productId: string; variantId?: string; lotId?: string }) =>
      request<CycleCountTaskResponse>('/cycle-count/tasks', { method: 'POST', body: JSON.stringify(body) }),
    assign: (id: string, assignedToId: string) =>
      request<CycleCountTaskResponse>(`/cycle-count/tasks/${id}/assign`, { method: 'POST', body: JSON.stringify({ assignedToId }) }),
    start: (id: string) => request<CycleCountTaskResponse>(`/cycle-count/tasks/${id}/start`, { method: 'POST' }),
    cancel: (id: string) => request<CycleCountTaskResponse>(`/cycle-count/tasks/${id}/cancel`, { method: 'POST' }),
    recount: (id: string) => request<CycleCountTaskResponse>(`/cycle-count/tasks/${id}/recount`, { method: 'POST' }),
  },

  members: () => request<MembershipUserResponse[]>('/users'),

  outbox: {
    health: () => request<OutboxHealthResponse>('/outbox/health'),
    events: (limit = 50) => request<OutboxEventListItem[]>(`/outbox/events?limit=${limit}`),
    retry: (id: string) => request<{ ok: true }>(`/outbox/${id}/retry`, { method: 'POST' }),
  },

  notifications: {
    list: (unread = false) => request<NotificationResponse[]>(`/notifications${unread ? '?unread=true' : ''}`),
    unreadCount: () => request<UnreadCountResponse>('/notifications/unread-count'),
    read: (id: string) => request<{ ok: true }>(`/notifications/${id}/read`, { method: 'POST' }),
    readAll: () => request<{ updated: number }>('/notifications/read-all', { method: 'POST' }),
    dismiss: (id: string) => request<{ ok: true }>(`/notifications/${id}/dismiss`, { method: 'POST' }),
    preferences: () => request<NotificationPreferenceResponse[]>('/notification-preferences'),
    setPreference: (notificationType: string, channel: string, enabled: boolean) =>
      request<NotificationPreferenceResponse>('/notification-preferences', { method: 'PUT', body: JSON.stringify({ notificationType, channel, enabled }) }),
    deliveries: () => request<NotificationDeliveryListItem[]>('/notification-deliveries'),
    webhook: {
      get: () => request<OrganizationWebhookConfigResponse>('/notification-webhook'),
      save: (body: { url: string; enabled: boolean; signingSecret?: string }) =>
        request<OrganizationWebhookConfigResponse>('/notification-webhook', { method: 'PUT', body: JSON.stringify(body) }),
      setSubscription: (notificationType: string, enabled: boolean) =>
        request<OrganizationWebhookConfigResponse>('/notification-webhook/subscriptions', { method: 'PUT', body: JSON.stringify({ notificationType, enabled }) }),
    },
  },

  dashboard: () => request<DashboardSummary>('/dashboard/summary'),
  reorder: () => request<ReorderAssessment[]>('/reorder/recommendations'),

  reports: {
    valuation: (groupBy: ValuationGrouping) => request<ValuationReport>(`/reports/valuation?groupBy=${groupBy}`),
    stockStatus: (state?: ReorderState) =>
      request<ReorderAssessment[]>(`/reports/stock-status${state ? `?state=${state}` : ''}`),
    deadStock: (days = 90) => request<DeadStockRow[]>(`/reports/dead-stock?days=${days}`),
  },

  categories: {
    list: (q?: string, status?: EntityStatus) => request<CategoryResponse[]>(`/categories${catalogQs(q, status)}`),
    create: (body: { name: string; parentId?: string }) =>
      request<CategoryResponse>('/categories', { method: 'POST', body: JSON.stringify(body) }),
    update: (id: string, body: { name?: string; parentId?: string | null }) =>
      request<CategoryResponse>(`/categories/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    changeStatus: (id: string, status: EntityStatus) =>
      request<CategoryResponse>(`/categories/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) }),
  },
  brands: {
    list: (q?: string, status?: EntityStatus) => request<BrandResponse[]>(`/brands${catalogQs(q, status)}`),
    create: (body: { name: string; manufacturer?: string }) =>
      request<BrandResponse>('/brands', { method: 'POST', body: JSON.stringify(body) }),
    update: (id: string, body: { name?: string; manufacturer?: string }) =>
      request<BrandResponse>(`/brands/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    changeStatus: (id: string, status: EntityStatus) =>
      request<BrandResponse>(`/brands/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) }),
  },
  units: {
    list: (q?: string, status?: EntityStatus) => request<UnitResponse[]>(`/units${catalogQs(q, status)}`),
    create: (body: { code: string; name: string; precision?: number }) =>
      request<UnitResponse>('/units', { method: 'POST', body: JSON.stringify(body) }),
    update: (id: string, body: { name?: string; precision?: number }) =>
      request<UnitResponse>(`/units/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    changeStatus: (id: string, status: EntityStatus) =>
      request<UnitResponse>(`/units/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) }),
    conversions: () => request<UnitConversionResponse[]>('/unit-conversions'),
    createConversion: (body: { fromUomId: string; toUomId: string; factor: number }) =>
      request<UnitConversionResponse>('/unit-conversions', { method: 'POST', body: JSON.stringify(body) }),
    deleteConversion: (id: string) => request<void>(`/unit-conversions/${id}`, { method: 'DELETE' }),
  },
  audit: {
    search: (filter: AuditFilter = {}) => {
      const p = new URLSearchParams();
      for (const [k, v] of Object.entries(filter)) if (v !== undefined && v !== '') p.set(k, String(v));
      const qs = p.toString();
      return request<AuditPage>(`/audit${qs ? `?${qs}` : ''}`);
    },
    forEntity: (entityType: string, entityId: string) =>
      request<AuditPage>(`/audit?entityType=${entityType}&entityId=${entityId}`).then((r) => r.entries),
    correlation: (correlationId: string) =>
      request<AuditEntryResponse[]>(`/audit/correlation/${correlationId}`),
  },

  productAdmin: {
    get: (id: string) => request<ProductResponse>(`/products/${id}`),
    create: (body: Record<string, unknown>) =>
      request<ProductResponse>('/products', { method: 'POST', body: JSON.stringify(body) }),
    update: (id: string, body: Record<string, unknown>) =>
      request<ProductResponse>(`/products/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    changeStatus: (id: string, status: EntityStatus) =>
      request<ProductResponse>(`/products/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) }),
    addVariant: (id: string, body: { sku: string; attributes?: Record<string, unknown>; cost?: number; sellingPrice?: number }) =>
      request<VariantResponse>(`/products/${id}/variants`, { method: 'POST', body: JSON.stringify(body) }),
    changeVariantStatus: (id: string, variantId: string, status: EntityStatus) =>
      request<VariantResponse>(`/products/${id}/variants/${variantId}/status`, { method: 'POST', body: JSON.stringify({ status }) }),
    barcodes: (id: string) => request<BarcodeResponse[]>(`/products/${id}/barcodes`),
    assignBarcode: (id: string, body: { code: string; variantId?: string; barcodeType?: BarcodeType; isPrimary?: boolean }) =>
      request<BarcodeResponse>(`/products/${id}/barcodes`, { method: 'POST', body: JSON.stringify(body) }),
    updateBarcode: (id: string, barcodeId: string, body: { isPrimary?: boolean; status?: EntityStatus; barcodeType?: BarcodeType }) =>
      request<BarcodeResponse>(`/products/${id}/barcodes/${barcodeId}`, { method: 'PATCH', body: JSON.stringify(body) }),
    removeBarcode: (id: string, barcodeId: string) =>
      request<void>(`/products/${id}/barcodes/${barcodeId}`, { method: 'DELETE' }),
    policies: (id: string) => request<InventoryPolicyResponse[]>(`/products/${id}/policies`),
    createPolicy: (
      id: string,
      body: {
        warehouseId: string;
        variantId?: string;
        minStock?: number;
        maxStock?: number;
        reorderPoint?: number;
        reorderQuantity: number;
        preferredSupplierId?: string;
      },
    ) => request<InventoryPolicyResponse>(`/products/${id}/policies`, { method: 'POST', body: JSON.stringify(body) }),
    updatePolicy: (
      policyId: string,
      body: {
        minStock?: number;
        maxStock?: number | null;
        reorderPoint?: number;
        reorderQuantity?: number;
        preferredSupplierId?: string | null;
      },
    ) => request<InventoryPolicyResponse>(`/inventory-policies/${policyId}`, { method: 'PATCH', body: JSON.stringify(body) }),
    changePolicyStatus: (policyId: string, status: EntityStatus) =>
      request<InventoryPolicyResponse>(`/inventory-policies/${policyId}/status`, { method: 'POST', body: JSON.stringify({ status }) }),
  },
  resolve: (code: string) => request<BarcodeResolutionResult>(`/resolve?code=${encodeURIComponent(code)}`),
  resolveDiagnose: (code: string) => request<ScanDiagnosis>(`/resolve/diagnose?code=${encodeURIComponent(code)}`),
  search: (q: string, limit = 30) => request<SearchResult[]>(`/search?q=${encodeURIComponent(q)}&limit=${limit}`),

  exports: {
    download: (path: string, filename: string) => downloadCsv(path, filename),
  },

  reservations: {
    list: (filters: Record<string, string> = {}) => {
      const p = new URLSearchParams();
      for (const [k, v] of Object.entries(filters)) if (v) p.set(k, v);
      const qs = p.toString();
      return request<ReservationResponse[]>(`/reservations${qs ? `?${qs}` : ''}`);
    },
    get: (id: string) => request<ReservationResponse>(`/reservations/${id}`),
    create: (body: Record<string, unknown>) =>
      request<ReservationResponse>('/reservations', { method: 'POST', body: JSON.stringify(body) }),
    confirm: (id: string) => request<ReservationResponse>(`/reservations/${id}/confirm`, { method: 'POST' }),
    release: (id: string) => request<ReservationResponse>(`/reservations/${id}/release`, { method: 'POST' }),
    cancel: (id: string) => request<ReservationResponse>(`/reservations/${id}/cancel`, { method: 'POST' }),
    reservedBreakdown: (productId: string, warehouseId: string, variantId?: string) =>
      request<ReservedBreakdownRow[]>(`/reservations/reserved-breakdown?productId=${productId}&warehouseId=${warehouseId}${variantId ? `&variantId=${variantId}` : ''}`),
  },

  returns: {
    list: (filters: Record<string, string> = {}) => {
      const p = new URLSearchParams();
      for (const [k, v] of Object.entries(filters)) if (v) p.set(k, v);
      const qs = p.toString();
      return request<ReturnResponse[]>(`/returns${qs ? `?${qs}` : ''}`);
    },
    get: (id: string) => request<ReturnResponse>(`/returns/${id}`),
    create: (body: Record<string, unknown>) =>
      request<ReturnResponse>('/returns', { method: 'POST', body: JSON.stringify(body) }),
    receive: (id: string, body: Record<string, unknown> = {}) =>
      request<ReturnResponse>(`/returns/${id}/receive`, { method: 'POST', body: JSON.stringify(body) }),
    cancel: (id: string) => request<ReturnResponse>(`/returns/${id}/cancel`, { method: 'POST' }),
    dispose: (id: string, body: Record<string, unknown>) =>
      request<ReturnResponse>(`/returns/${id}/dispositions`, { method: 'POST', body: JSON.stringify(body) }),
    quarantineBreakdown: (productId: string, warehouseId: string, variantId?: string) =>
      request<QuarantineBreakdownRow[]>(`/returns/quarantine-breakdown?productId=${productId}&warehouseId=${warehouseId}${variantId ? `&variantId=${variantId}` : ''}`),
  },

  lots: {
    list: (filters: Record<string, string> = {}) => {
      const p = new URLSearchParams();
      for (const [k, v] of Object.entries(filters)) if (v) p.set(k, v);
      const qs = p.toString();
      return request<LotResponse[]>(`/lots${qs ? `?${qs}` : ''}`);
    },
    get: (id: string) => request<LotResponse>(`/lots/${id}`),
    movements: (id: string) => request<LotMovementRow[]>(`/lots/${id}/movements`),
    pickable: (productId: string, warehouseId: string, variantId?: string) =>
      request<PickableLot[]>(`/lots/pickable?productId=${productId}&warehouseId=${warehouseId}${variantId ? `&variantId=${variantId}` : ''}`),
    close: (id: string) => request<LotResponse>(`/lots/${id}/close`, { method: 'POST' }),
    fefoPlan: (productId: string, warehouseId: string, quantity: number, variantId?: string) =>
      request<AllocationPlan>(`/lots/fefo-plan?productId=${productId}&warehouseId=${warehouseId}&quantity=${quantity}${variantId ? `&variantId=${variantId}` : ''}`),
    expiryDashboard: (filters: Record<string, string> = {}) => {
      const p = new URLSearchParams();
      for (const [k, v] of Object.entries(filters)) if (v) p.set(k, v);
      const qs = p.toString();
      return request<ExpiryDashboardRow[]>(`/lots/expiry-dashboard${qs ? `?${qs}` : ''}`);
    },
    expiryScan: () => request<{ expired: number; expiringSoon: number }>('/lots/expiry-scan', { method: 'POST' }),
    expiryFacts: (eventType?: string) => request<LotExpiryFactResponse[]>(`/lots/expiry-facts${eventType ? `?eventType=${eventType}` : ''}`),
  },

  imports: {
    preview: (type: 'products' | 'suppliers' | 'opening-inventory', fileName: string, content: string) =>
      request<ImportPreviewResponse>(`/imports/${type}/preview`, { method: 'POST', body: JSON.stringify({ fileName, content }) }),
    commit: (jobId: string) => request<ImportJobResponse>(`/imports/${jobId}/commit`, { method: 'POST' }),
    job: (jobId: string) => request<ImportPreviewResponse>(`/imports/${jobId}`),
  },

  supplierAdmin: {
    get: (id: string) => request<SupplierResponse>(`/suppliers/${id}`),
    create: (body: Record<string, unknown>) =>
      request<SupplierResponse>('/suppliers', { method: 'POST', body: JSON.stringify(body) }),
    update: (id: string, body: Record<string, unknown>) =>
      request<SupplierResponse>(`/suppliers/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    changeStatus: (id: string, status: EntityStatus) =>
      request<SupplierResponse>(`/suppliers/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) }),
    products: (id: string) => request<SupplierProductResponse[]>(`/suppliers/${id}/products`),
    addProduct: (
      id: string,
      body: { productId: string; supplierSku?: string; cost?: number; leadTimeDays?: number; minOrderQty?: number; isPreferred?: boolean },
    ) => request<SupplierProductResponse>(`/suppliers/${id}/products`, { method: 'POST', body: JSON.stringify(body) }),
    updateProduct: (
      id: string,
      supplierProductId: string,
      body: { supplierSku?: string; cost?: number; leadTimeDays?: number; minOrderQty?: number; isPreferred?: boolean },
    ) => request<SupplierProductResponse>(`/suppliers/${id}/products/${supplierProductId}`, { method: 'PATCH', body: JSON.stringify(body) }),
    changeProductStatus: (id: string, supplierProductId: string, status: EntityStatus) =>
      request<SupplierProductResponse>(`/suppliers/${id}/products/${supplierProductId}/status`, { method: 'POST', body: JSON.stringify({ status }) }),
  },

  warehouseAdmin: {
    get: (id: string) => request<WarehouseResponse>(`/warehouses/${id}`),
    create: (body: Record<string, unknown>) =>
      request<WarehouseResponse>('/warehouses', { method: 'POST', body: JSON.stringify(body) }),
    update: (id: string, body: Record<string, unknown>) =>
      request<WarehouseResponse>(`/warehouses/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    changeStatus: (id: string, status: EntityStatus) =>
      request<WarehouseResponse>(`/warehouses/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) }),
    locations: (id: string) => request<WarehouseLocationResponse[]>(`/warehouses/${id}/locations`),
    createLocation: (
      id: string,
      body: { code: string; name?: string; type?: string; usage?: LocationUsage; parentId?: string; isPickable?: boolean },
    ) => request<WarehouseLocationResponse>(`/warehouses/${id}/locations`, { method: 'POST', body: JSON.stringify(body) }),
    updateLocation: (
      id: string,
      locationId: string,
      body: { name?: string; type?: string; usage?: LocationUsage; isPickable?: boolean },
    ) => request<WarehouseLocationResponse>(`/warehouses/${id}/locations/${locationId}`, { method: 'PATCH', body: JSON.stringify(body) }),
    moveLocation: (id: string, locationId: string, parentId: string | null) =>
      request<WarehouseLocationResponse>(`/warehouses/${id}/locations/${locationId}/move`, { method: 'POST', body: JSON.stringify({ parentId }) }),
    changeLocationStatus: (id: string, locationId: string, status: EntityStatus) =>
      request<WarehouseLocationResponse>(`/warehouses/${id}/locations/${locationId}/status`, { method: 'POST', body: JSON.stringify({ status }) }),
    policies: (id: string) => request<InventoryPolicyResponse[]>(`/warehouses/${id}/policies`),
  },

  serials: {
    list: (filters: { productId?: string; warehouseId?: string; status?: SerialStatus; lotId?: string; q?: string; inInventory?: boolean } = {}) => {
      const p = new URLSearchParams();
      for (const [k, v] of Object.entries(filters)) if (v !== undefined && v !== '' && v !== false) p.set(k, String(v));
      const qs = p.toString();
      return request<SerialResponse[]>(`/serials${qs ? `?${qs}` : ''}`);
    },
    get: (id: string) => request<SerialResponse>(`/serials/${id}`),
    history: (id: string) => request<SerialHistoryResponse>(`/serials/${id}/history`),
    reconcile: (productId?: string) =>
      request<SerialReconciliationResult>(`/serials/reconcile${productId ? `?productId=${productId}` : ''}`),
    policy: (productId: string) => request<SerialTrackingPolicyResponse>(`/serials/policies/${productId}`),
    savePolicy: (productId: string, body: { captureMode: 'RECEIPT' | 'ISSUE'; requireLotWhenBatchTracked?: boolean }) =>
      request<SerialTrackingPolicyResponse>(`/serials/policies/${productId}`, { method: 'PUT', body: JSON.stringify(body) }),
  },

  // Mobile Scanner PWA (2D.6B). Worklists + advisory claims; command submit lives in lib/mobile/submit.ts
  // because it needs bespoke timeout / SUBMISSION_UNKNOWN handling the generic request() can't express.
  mobile: {
    work: (type: MobileWorkType) => request<MobileWorkItem[]>(`/mobile/work/${type}`),
    claim: (type: MobileWorkType, id: string, deviceId: string, leaseSeconds?: number) =>
      request<MobileWorkClaim>(`/mobile/work/${type}/${id}/claim`, { method: 'POST', body: JSON.stringify({ deviceId, ...(leaseSeconds ? { leaseSeconds } : {}) }) }),
    releaseClaim: (type: MobileWorkType, id: string) =>
      request<void>(`/mobile/work/${type}/${id}/claim`, { method: 'DELETE' }),
  },
};

function catalogQs(q?: string, status?: EntityStatus): string {
  const p = new URLSearchParams();
  if (q) p.set('q', q);
  if (status) p.set('status', status);
  const s = p.toString();
  return s ? `?${s}` : '';
}
