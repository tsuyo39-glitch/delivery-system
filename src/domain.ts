import type {
  Delivery,
  DeliveryRoute,
  DeliveryStatus,
  DriverReport,
  Location,
  LocationType,
  Truck,
} from './types';

export type BackupPayload = {
  version: 1;
  exportedAt: string;
  trucks: Truck[];
  locations: Location[];
  deliveries: Delivery[];
  deliveryRoutes: DeliveryRoute[];
  driverReports: DriverReport[];
};

export type PlanningMasterWarning = {
  id: string;
  label: string;
  target: 'trucks' | 'locations';
};

export type DeliveryPlanCsvSummary = {
  deliveryId: string;
  etaLabel: string;
  costLabel: string;
};

export const deliveryPlanCsvHeaders = [
  '配車ID',
  '日付',
  '社名',
  'ドライバー',
  '車番',
  '出発地',
  '配送順',
  '想定時間',
  '想定コスト',
  '高速利用',
  '宵積み',
  'バッファ',
];

export function hasTruckAssignmentConflict(
  deliveries: Delivery[],
  date: string,
  truckId: string,
): boolean {
  return deliveries.some((delivery) => delivery.date === date && delivery.truckId === truckId);
}

export function canAddRouteStop(
  deliveryRoutes: DeliveryRoute[],
  deliveryId: string,
  locationId: string,
): boolean {
  return !deliveryRoutes.some(
    (routeItem) => routeItem.deliveryId === deliveryId && routeItem.locationId === locationId,
  );
}

export function getPlanningMasterWarnings(
  trucks: Truck[],
  locations: Location[],
): PlanningMasterWarning[] {
  const departureLocations = locations.filter((location) => location.type === 'departure');
  const destinationLocations = locations.filter((location) => location.type === 'destination');
  const warnings: PlanningMasterWarning[] = [];

  if (trucks.length === 0) {
    warnings.push({
      id: 'trucks',
      label: 'トラックマスターが未登録です。',
      target: 'trucks',
    });
  }

  if (departureLocations.length === 0) {
    warnings.push({
      id: 'departures',
      label: '出発地マスターが未登録です。',
      target: 'locations',
    });
  }

  if (destinationLocations.length === 0) {
    warnings.push({
      id: 'destinations',
      label: '向け地マスターが未登録です。',
      target: 'locations',
    });
  }

  return warnings;
}

export function buildDeliveryPlanCsvRows(
  deliveries: Delivery[],
  deliveryRoutes: DeliveryRoute[],
  locations: Location[],
  trucks: Truck[],
  summaries: DeliveryPlanCsvSummary[],
): string[][] {
  return deliveries.map((delivery) => {
    const truck = trucks.find((item) => item.id === delivery.truckId);
    const summary = summaries.find((item) => item.deliveryId === delivery.id);
    const routes = deliveryRoutes
      .filter((routeItem) => routeItem.deliveryId === delivery.id)
      .sort((a, b) => a.order - b.order);
    const routeNames = routes
      .map((routeItem, index) => `${index + 1}. ${findLocationName(routeItem.locationId, locations)}`)
      .join(' / ');

    return [
      delivery.id,
      delivery.date,
      truck?.companyName ?? '未設定',
      truck?.driverName ?? '未設定',
      truck?.vehicleNumber ?? '未設定',
      findLocationName(delivery.departureLocationId, locations),
      routeNames || '未設定',
      summary?.etaLabel ?? '未計算',
      summary?.costLabel ?? '未計算',
      delivery.useExpressway ? 'あり' : 'なし',
      delivery.isNightBeforeLoaded ? 'あり' : 'なし',
      `${delivery.bufferMinutes}分`,
    ];
  });
}

function findLocationName(locationId: string, locations: Location[]): string {
  const location = locations.find((item) => item.id === locationId);
  return location ? `${location.postalCode} ${location.address}` : '未設定';
}

export function reorderRouteBefore(
  routes: DeliveryRoute[],
  draggedRouteId: string,
  targetRouteId: string,
): DeliveryRoute[] {
  const fromIndex = routes.findIndex((routeItem) => routeItem.id === draggedRouteId);
  const toIndex = routes.findIndex((routeItem) => routeItem.id === targetRouteId);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
    return routes;
  }

  const reordered = [...routes];
  const [draggedRoute] = reordered.splice(fromIndex, 1);
  const insertionIndex = fromIndex < toIndex ? toIndex - 1 : toIndex;
  reordered.splice(insertionIndex, 0, draggedRoute);

  return reordered.map((routeItem, index) => ({
    ...routeItem,
    order: index + 1,
  }));
}

const deliveryStatuses: DeliveryStatus[] = [
  'not_started',
  'departed',
  'loaded',
  'arrived',
  'unloaded',
];
const locationTypes: LocationType[] = ['departure', 'destination'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isTruck(value: unknown): value is Truck {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isString(value.companyName) &&
    isString(value.driverName) &&
    isString(value.vehicleNumber) &&
    isNumber(value.maxLoadKg) &&
    isString(value.driverKnowledge)
  );
}

function isLocation(value: unknown): value is Location {
  return (
    isRecord(value) &&
    isString(value.id) &&
    locationTypes.includes(value.type as LocationType) &&
    isString(value.postalCode) &&
    isString(value.address) &&
    isString(value.phoneNumber)
  );
}

function isDelivery(value: unknown): value is Delivery {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isString(value.truckId) &&
    isString(value.departureLocationId) &&
    isString(value.date) &&
    isBoolean(value.isNightBeforeLoaded) &&
    isBoolean(value.useExpressway) &&
    (value.bufferMinutes === 15 || value.bufferMinutes === 30)
  );
}

function isDeliveryRoute(value: unknown): value is DeliveryRoute {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isString(value.deliveryId) &&
    isString(value.locationId) &&
    isNumber(value.order)
  );
}

function isDriverReport(value: unknown): value is DriverReport {
  if (
    !isRecord(value) ||
    !isString(value.deliveryId) ||
    !deliveryStatuses.includes(value.status as DeliveryStatus) ||
    !isNumber(value.latitude) ||
    !isNumber(value.longitude) ||
    !isString(value.lastSyncedAt) ||
    !isString(value.lastReportedAt)
  ) {
    return false;
  }

  if (value.history === undefined) {
    return true;
  }

  return (
    Array.isArray(value.history) &&
    value.history.every(
      (item) =>
        isRecord(item) &&
        deliveryStatuses.includes(item.status as DeliveryStatus) &&
        isString(item.reportedAt),
    )
  );
}

export function validateBackupPayload(payload: Partial<BackupPayload>): string | null {
  if (
    payload.version !== 1 ||
    !Array.isArray(payload.trucks) ||
    !Array.isArray(payload.locations) ||
    !Array.isArray(payload.deliveries) ||
    !Array.isArray(payload.deliveryRoutes) ||
    !Array.isArray(payload.driverReports)
  ) {
    return '復元できません。バックアップJSONの形式を確認してください。';
  }

  if (!payload.trucks.every(isTruck)) {
    return '復元できません。トラックデータの項目を確認してください。';
  }
  if (!payload.locations.every(isLocation)) {
    return '復元できません。拠点データの項目を確認してください。';
  }
  if (!payload.deliveries.every(isDelivery)) {
    return '復元できません。配車データの項目を確認してください。';
  }
  if (!payload.deliveryRoutes.every(isDeliveryRoute)) {
    return '復元できません。配送順データの項目を確認してください。';
  }
  if (!payload.driverReports.every(isDriverReport)) {
    return '復元できません。運行報告データの項目を確認してください。';
  }

  const truckIds = new Set(payload.trucks.map((truck) => truck.id));
  const locationIds = new Set(payload.locations.map((location) => location.id));
  const deliveryIds = new Set(payload.deliveries.map((delivery) => delivery.id));

  if (payload.deliveries.some((delivery) => !truckIds.has(delivery.truckId))) {
    return '復元できません。存在しないトラックを参照する配車があります。';
  }
  if (payload.deliveries.some((delivery) => !locationIds.has(delivery.departureLocationId))) {
    return '復元できません。存在しない出発地を参照する配車があります。';
  }
  if (payload.deliveryRoutes.some((routeItem) => !deliveryIds.has(routeItem.deliveryId))) {
    return '復元できません。存在しない配車を参照する配送順があります。';
  }
  if (payload.deliveryRoutes.some((routeItem) => !locationIds.has(routeItem.locationId))) {
    return '復元できません。存在しない拠点を参照する配送順があります。';
  }
  if (payload.driverReports.some((report) => !deliveryIds.has(report.deliveryId))) {
    return '復元できません。存在しない配車を参照する運行報告があります。';
  }

  return null;
}
