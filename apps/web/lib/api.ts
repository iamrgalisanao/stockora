import type {
  AdjustmentDirection,
  AdjustmentListItem,
  AdjustmentReasonResponse,
  AdjustmentResponse,
  AuditEntryResponse,
  AuthenticatedUser,
  AuthTokenResponse,
  BalanceResponse,
  BarcodeResolutionResult,
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
  TransferListItem,
  TransferResponse,
  WarehouseResponse,
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
  items: Array<{ productId: string; requestedQty: number }>;
}

export interface CreateReceiptBody {
  supplierId?: string;
  warehouseId: string;
  purchaseOrderRef?: string;
  notes?: string;
  items: Array<{ productId: string; expectedQty?: number; receivedQty?: number; unitCost?: number }>;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4100';
const TOKEN_KEY = 'iw_token';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string): void {
  try {
    window.localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* ignore storage errors */
  }
}

export function clearToken(): void {
  try {
    window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_URL}/api${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });

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

export const api = {
  register: (body: RegisterOrganizationRequest) =>
    request<AuthTokenResponse>('/auth/register', { method: 'POST', body: JSON.stringify(body) }),
  login: (body: LoginRequest) =>
    request<AuthTokenResponse>('/auth/login', { method: 'POST', body: JSON.stringify(body) }),
  me: () => request<AuthenticatedUser>('/auth/me'),
  currentOrganization: () => request<OrganizationResponse>('/organizations/current'),

  products: (status?: EntityStatus) => request<ProductResponse[]>(`/products${status ? `?status=${status}` : ''}`),
  warehouses: () => request<WarehouseResponse[]>('/warehouses'),
  suppliers: () => request<SupplierResponse[]>('/suppliers'),
  balances: (params?: { warehouseId?: string; productId?: string }) => {
    const q = new URLSearchParams();
    if (params?.warehouseId) q.set('warehouseId', params.warehouseId);
    if (params?.productId) q.set('productId', params.productId);
    const qs = q.toString();
    return request<BalanceResponse[]>(`/inventory/balances${qs ? `?${qs}` : ''}`);
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
    post: (id: string) => request<ReleaseResponse>(`/releases/${id}/post`, { method: 'POST' }),
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
    dispatch: (id: string) => request<TransferResponse>(`/transfers/${id}/dispatch`, { method: 'POST' }),
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
  audit: (entityType: string, entityId: string) =>
    request<AuditEntryResponse[]>(`/audit?entityType=${entityType}&entityId=${entityId}`),

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
};

function catalogQs(q?: string, status?: EntityStatus): string {
  const p = new URLSearchParams();
  if (q) p.set('q', q);
  if (status) p.set('status', status);
  const s = p.toString();
  return s ? `?${s}` : '';
}
