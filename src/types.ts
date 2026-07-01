export type LocationType = 'departure' | 'destination';
export type DeliveryStatus = 'not_started' | 'departed' | 'loaded' | 'arrived' | 'unloaded';

export type Truck = {
  id: string;
  companyName: string;
  driverName: string;
  vehicleNumber: string;
  maxLoadKg: number;
  driverKnowledge: string;
};

export type Location = {
  id: string;
  type: LocationType;
  postalCode: string;
  address: string;
  phoneNumber: string;
};

export type Delivery = {
  id: string;
  truckId: string;
  departureLocationId: string;
  date: string;
  isNightBeforeLoaded: boolean;
  useExpressway: boolean;
  bufferMinutes: 15 | 30;
};

export type DeliveryRoute = {
  id: string;
  deliveryId: string;
  locationId: string;
  order: number;
};

export type DriverReport = {
  deliveryId: string;
  status: DeliveryStatus;
  latitude: number;
  longitude: number;
  lastSyncedAt: string;
  lastReportedAt: string;
};

export type RouteSimulation = {
  routeLabel: string;
  etaMinutes: number;
  costYen: number;
  distanceKm: number;
  weatherRisk: '低' | '中' | '高';
  windySummary: string;
};
