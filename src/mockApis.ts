import type { Delivery, DeliveryRoute, Location, RouteSimulation, Truck } from './types';

type SimulationInput = {
  delivery: Delivery;
  routes: DeliveryRoute[];
  locations: Location[];
  truck: Truck;
};

export function simulateRoute({
  delivery,
  routes,
  locations,
  truck,
}: SimulationInput): RouteSimulation {
  const stops = routes.length;
  const baseMinutes = 42 + stops * 34 + delivery.bufferMinutes * stops;
  const expresswayReduction = delivery.useExpressway ? Math.round(baseMinutes * 0.22) : 0;
  const etaMinutes = baseMinutes - expresswayReduction;
  const expresswayCost = delivery.useExpressway ? 1850 + stops * 620 : 0;
  const distanceKm = 28 + stops * 18 + (delivery.useExpressway ? 8 : 0);
  const coastalStops = routes
    .map((route) => locations.find((location) => location.id === route.locationId))
    .filter((location) => location?.address.includes('港')).length;
  const weatherRisk = coastalStops > 0 && delivery.useExpressway ? '中' : '低';

  return {
    routeLabel: `${truck.driverName} 推奨ルート`,
    etaMinutes,
    costYen: expresswayCost,
    distanceKm,
    weatherRisk,
    windySummary:
      weatherRisk === '中'
        ? '湾岸部で横風注意。Windyモック値: 北東 8m/s'
        : '主要区間の気象リスクは低め。Windyモック値: 北 3m/s',
  };
}
