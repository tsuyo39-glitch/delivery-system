import { initialDeliveries, initialDeliveryRoutes, locations, trucks } from './data';
import type { Delivery, DeliveryRoute, DriverReport, Location, Truck } from './types';

const DELIVERY_KEY = 'delivery-planning.deliveries';
const ROUTE_KEY = 'delivery-planning.delivery-routes';
const TRUCK_KEY = 'delivery-planning.trucks';
const LOCATION_KEY = 'delivery-planning.locations';
const DRIVER_REPORT_KEY = 'delivery-planning.driver-reports';

function readJson<T>(key: string, fallback: T): T {
  try {
    const item = window.localStorage.getItem(key);
    return item ? (JSON.parse(item) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function readDeliveries(): Delivery[] {
  return readJson(DELIVERY_KEY, initialDeliveries);
}

export function readDeliveryRoutes(): DeliveryRoute[] {
  return readJson(ROUTE_KEY, initialDeliveryRoutes);
}

export function readTrucks(): Truck[] {
  return readJson(TRUCK_KEY, trucks);
}

export function readLocations(): Location[] {
  return readJson(LOCATION_KEY, locations);
}

export function readDriverReports(): DriverReport[] {
  return readJson(DRIVER_REPORT_KEY, []);
}

export function saveDeliveries(deliveries: Delivery[]): void {
  window.localStorage.setItem(DELIVERY_KEY, JSON.stringify(deliveries));
}

export function saveDeliveryRoutes(routes: DeliveryRoute[]): void {
  window.localStorage.setItem(ROUTE_KEY, JSON.stringify(routes));
}

export function saveTrucks(nextTrucks: Truck[]): void {
  window.localStorage.setItem(TRUCK_KEY, JSON.stringify(nextTrucks));
}

export function saveLocations(nextLocations: Location[]): void {
  window.localStorage.setItem(LOCATION_KEY, JSON.stringify(nextLocations));
}

export function saveDriverReports(reports: DriverReport[]): void {
  window.localStorage.setItem(DRIVER_REPORT_KEY, JSON.stringify(reports));
}
