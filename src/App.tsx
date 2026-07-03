import {
  ArrowDown,
  ArrowUp,
  BarChart3,
  CalendarDays,
  ClipboardList,
  Copy,
  MapPinned,
  MapPin,
  Navigation,
  CloudSun,
  Database,
  Download,
  Sparkles,
  Plus,
  Printer,
  Route,
  Save,
  Smartphone,
  Trash2,
  Truck as TruckIcon,
} from 'lucide-react';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { locations as initialLocations, trucks as initialTrucks } from './data';
import { simulateRoute } from './mockApis';
import {
  readDeliveries,
  readDeliveryRoutes,
  readDriverReports,
  readLocations,
  readTrucks,
  saveDeliveries,
  saveDeliveryRoutes,
  saveDriverReports,
  saveLocations,
  saveTrucks,
} from './storage';
import type {
  Delivery,
  DeliveryRoute,
  DeliveryStatus,
  DriverReport,
  Location,
  LocationType,
  Truck,
} from './types';

type DeliveryForm = {
  date: string;
  truckId: string;
  departureLocationId: string;
  destinationLocationId: string;
  isNightBeforeLoaded: boolean;
  useExpressway: boolean;
  bufferMinutes: 15 | 30;
};

type TruckForm = Omit<Truck, 'id'>;
type LocationForm = Omit<Location, 'id'>;
type ActiveView = 'dashboard' | 'planning' | 'driver' | 'api' | 'data' | 'trucks' | 'locations';
type DashboardFilter = 'all' | 'notStarted' | 'running' | 'completed' | 'weatherRisk';
type BackupPayload = {
  version: 1;
  exportedAt: string;
  trucks: Truck[];
  locations: Location[];
  deliveries: Delivery[];
  deliveryRoutes: DeliveryRoute[];
  driverReports: DriverReport[];
};
type IntegrityIssue = {
  id: string;
  message: string;
  target: 'planning' | 'trucks' | 'locations';
  deliveryId?: string;
};

const statusLabels: Record<DeliveryStatus, string> = {
  not_started: '未出発',
  departed: '出発',
  loaded: '積み込み完了',
  arrived: '到着',
  unloaded: '荷降ろし完了',
};

const statusOrder: DeliveryStatus[] = ['departed', 'loaded', 'arrived', 'unloaded'];

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createDefaultForm(nextTrucks = initialTrucks, nextLocations = initialLocations): DeliveryForm {
  const departureLocations = nextLocations.filter((location) => location.type === 'departure');
  const destinationLocations = nextLocations.filter((location) => location.type === 'destination');

  return {
    date: new Date().toISOString().slice(0, 10),
    truckId: nextTrucks[0]?.id ?? '',
    departureLocationId: departureLocations[0]?.id ?? '',
    destinationLocationId: destinationLocations[0]?.id ?? '',
    isNightBeforeLoaded: false,
    useExpressway: true,
    bufferMinutes: 15,
  };
}

function createDefaultTruckForm(): TruckForm {
  return {
    companyName: '',
    driverName: '',
    vehicleNumber: '',
    maxLoadKg: 2000,
    driverKnowledge: '',
  };
}

function createDefaultLocationForm(): LocationForm {
  return {
    type: 'destination',
    postalCode: '',
    address: '',
    phoneNumber: '',
  };
}

function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return hours > 0 ? `${hours}時間${mins}分` : `${mins}分`;
}

function findLocationName(locationId: string, masterLocations: Location[]): string {
  const location = masterLocations.find((item) => item.id === locationId);
  return location ? `${location.postalCode} ${location.address}` : '未設定';
}

function getNextDate(date: string) {
  const value = new Date(`${date}T00:00:00`);
  if (Number.isNaN(value.getTime())) {
    return date;
  }

  value.setDate(value.getDate() + 1);
  return value.toISOString().slice(0, 10);
}

function createMockPosition(deliveryId: string): Pick<DriverReport, 'latitude' | 'longitude'> {
  const seed = [...deliveryId].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return {
    latitude: Number((35.62 + (seed % 38) / 1000).toFixed(6)),
    longitude: Number((139.68 + (seed % 44) / 1000).toFixed(6)),
  };
}

function escapeCsvValue(value: string | number | boolean | undefined) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function createMapPoint(id: string, index: number, total: number) {
  const seed = [...id].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const progress = total <= 1 ? 0.5 : index / (total - 1);
  return {
    left: 14 + progress * 72,
    top: 24 + ((seed % 37) - 18) * 0.8,
  };
}

function scoreRouteForDriver(route: DeliveryRoute, location: Location | undefined, truck: Truck | undefined) {
  if (!location || !truck) {
    return route.order;
  }

  let score = route.order * 10;
  const address = location.address;
  const knowledge = truck.driverKnowledge;

  if (knowledge.includes('湾岸') && address.includes('港')) {
    score -= 12;
  }

  if (knowledge.includes('内陸') && !address.includes('港')) {
    score -= 8;
  }

  if (knowledge.includes('積み下ろし') && (address.includes('駅') || address.includes('町'))) {
    score -= 6;
  }

  return score;
}

export function App() {
  const [masterTrucks, setMasterTrucks] = useState<Truck[]>(() => readTrucks());
  const [masterLocations, setMasterLocations] = useState<Location[]>(() => readLocations());
  const [deliveries, setDeliveries] = useState<Delivery[]>(() => readDeliveries());
  const [deliveryRoutes, setDeliveryRoutes] = useState<DeliveryRoute[]>(() => readDeliveryRoutes());
  const [driverReports, setDriverReports] = useState<DriverReport[]>(() => readDriverReports());
  const [selectedDeliveryId, setSelectedDeliveryId] = useState(() => readDeliveries()[0]?.id ?? '');
  const [form, setForm] = useState<DeliveryForm>(() => createDefaultForm(readTrucks(), readLocations()));
  const [truckForm, setTruckForm] = useState<TruckForm>(() => createDefaultTruckForm());
  const [locationForm, setLocationForm] = useState<LocationForm>(() => createDefaultLocationForm());
  const [activeView, setActiveView] = useState<ActiveView>('dashboard');
  const [dashboardFilter, setDashboardFilter] = useState<DashboardFilter>('all');
  const [dashboardSearch, setDashboardSearch] = useState('');
  const [dashboardDateFilter, setDashboardDateFilter] = useState('');
  const [optimizationNote, setOptimizationNote] = useState('ドライバー傾向を加味した推奨順序を生成できます。');
  const [truckSearch, setTruckSearch] = useState('');
  const [locationSearch, setLocationSearch] = useState('');
  const [deliverySearch, setDeliverySearch] = useState('');
  const [deliveryDateFilter, setDeliveryDateFilter] = useState('');
  const [backupText, setBackupText] = useState('');
  const [backupMessage, setBackupMessage] = useState('エクスポートまたは復元を実行してください。');

  const departureLocations = useMemo(
    () => masterLocations.filter((location) => location.type === 'departure'),
    [masterLocations],
  );
  const destinationLocations = useMemo(
    () => masterLocations.filter((location) => location.type === 'destination'),
    [masterLocations],
  );
  const filteredMasterTrucks = useMemo(() => {
    const keyword = truckSearch.trim().toLowerCase();
    if (!keyword) {
      return masterTrucks;
    }

    return masterTrucks.filter((truck) =>
      [truck.companyName, truck.driverName, truck.vehicleNumber, String(truck.maxLoadKg), truck.driverKnowledge]
        .join(' ')
        .toLowerCase()
        .includes(keyword),
    );
  }, [masterTrucks, truckSearch]);
  const filteredMasterLocations = useMemo(() => {
    const keyword = locationSearch.trim().toLowerCase();
    if (!keyword) {
      return masterLocations;
    }

    return masterLocations.filter((location) =>
      [location.type, location.postalCode, location.address, location.phoneNumber]
        .join(' ')
        .toLowerCase()
        .includes(keyword),
    );
  }, [locationSearch, masterLocations]);
  const filteredDeliveries = useMemo(() => {
    const keyword = deliverySearch.trim().toLowerCase();

    return deliveries.filter((delivery) => {
      if (deliveryDateFilter && delivery.date !== deliveryDateFilter) {
        return false;
      }

      if (!keyword) {
        return true;
      }

      const truck = masterTrucks.find((item) => item.id === delivery.truckId);
      const routeNames = deliveryRoutes
        .filter((routeItem) => routeItem.deliveryId === delivery.id)
        .sort((a, b) => a.order - b.order)
        .map((routeItem) => findLocationName(routeItem.locationId, masterLocations));

      return [
        delivery.date,
        truck?.companyName,
        truck?.driverName,
        truck?.vehicleNumber,
        findLocationName(delivery.departureLocationId, masterLocations),
        ...routeNames,
      ]
        .join(' ')
        .toLowerCase()
        .includes(keyword);
    });
  }, [deliveries, deliveryDateFilter, deliveryRoutes, deliverySearch, masterLocations, masterTrucks]);

  const selectedDelivery = deliveries.find((delivery) => delivery.id === selectedDeliveryId);
  const selectedTruck =
    masterTrucks.find((truck) => truck.id === selectedDelivery?.truckId) ?? masterTrucks[0];
  const selectedRoutes = deliveryRoutes
    .filter((routeItem) => routeItem.deliveryId === selectedDeliveryId)
    .sort((a, b) => a.order - b.order);
  const selectedDriverReport = driverReports.find(
    (report) => report.deliveryId === selectedDeliveryId,
  );

  const simulation = useMemo(() => {
    if (!selectedDelivery || !selectedTruck) {
      return null;
    }

    return simulateRoute({
      delivery: selectedDelivery,
      routes: selectedRoutes,
      locations: masterLocations,
      truck: selectedTruck,
    });
  }, [masterLocations, selectedDelivery, selectedRoutes, selectedTruck]);

  const routeComparison = useMemo(() => {
    if (!selectedDelivery || !selectedTruck) {
      return null;
    }

    const expresswayDelivery = { ...selectedDelivery, useExpressway: true };
    const localRoadDelivery = { ...selectedDelivery, useExpressway: false };

    return {
      expressway: simulateRoute({
        delivery: expresswayDelivery,
        routes: selectedRoutes,
        locations: masterLocations,
        truck: selectedTruck,
      }),
      localRoad: simulateRoute({
        delivery: localRoadDelivery,
        routes: selectedRoutes,
        locations: masterLocations,
        truck: selectedTruck,
      }),
    };
  }, [masterLocations, selectedDelivery, selectedRoutes, selectedTruck]);

  const dashboardRows = useMemo(
    () =>
      deliveries.map((delivery) => {
        const truck = masterTrucks.find((item) => item.id === delivery.truckId);
        const routes = deliveryRoutes
          .filter((routeItem) => routeItem.deliveryId === delivery.id)
          .sort((a, b) => a.order - b.order);
        const report = driverReports.find((item) => item.deliveryId === delivery.id);
        const fallbackReport: DriverReport = {
          deliveryId: delivery.id,
          status: 'not_started',
          ...createMockPosition(delivery.id),
          lastSyncedAt: new Date().toISOString(),
          lastReportedAt: new Date().toISOString(),
        };
        const routeSimulation = truck
          ? simulateRoute({ delivery, routes, locations: masterLocations, truck })
          : null;

        return {
          delivery,
          truck,
          routes,
          report: report ?? fallbackReport,
          simulation: routeSimulation,
        };
      }),
    [deliveries, deliveryRoutes, driverReports, masterLocations, masterTrucks],
  );

  const dashboardStats = useMemo(() => {
    const notStarted = dashboardRows.filter((row) => row.report.status === 'not_started').length;
    const completed = dashboardRows.filter((row) => row.report.status === 'unloaded').length;
    const running = dashboardRows.filter(
      (row) => row.report.status !== 'not_started' && row.report.status !== 'unloaded',
    ).length;
    const weatherRisk = dashboardRows.filter(
      (row) => row.simulation?.weatherRisk === '中' || row.simulation?.weatherRisk === '高',
    ).length;

    return {
      total: dashboardRows.length,
      notStarted,
      running,
      completed,
      weatherRisk,
    };
  }, [dashboardRows]);

  const filteredDashboardRows = useMemo(
    () => {
      const keyword = dashboardSearch.trim().toLowerCase();

      return dashboardRows.filter((row) => {
        if (dashboardDateFilter && row.delivery.date !== dashboardDateFilter) {
          return false;
        }

        if (dashboardFilter === 'notStarted') {
          if (row.report.status !== 'not_started') {
            return false;
          }
        }

        if (dashboardFilter === 'running') {
          if (row.report.status === 'not_started' || row.report.status === 'unloaded') {
            return false;
          }
        }

        if (dashboardFilter === 'completed') {
          if (row.report.status !== 'unloaded') {
            return false;
          }
        }

        if (dashboardFilter === 'weatherRisk') {
          if (row.simulation?.weatherRisk !== '中' && row.simulation?.weatherRisk !== '高') {
            return false;
          }
        }

        if (!keyword) {
          return true;
        }

        return [
          row.delivery.date,
          row.truck?.companyName,
          row.truck?.driverName,
          row.truck?.vehicleNumber,
          findLocationName(row.delivery.departureLocationId, masterLocations),
          ...row.routes.map((routeItem) => findLocationName(routeItem.locationId, masterLocations)),
          statusLabels[row.report.status],
          row.simulation?.weatherRisk,
        ]
          .join(' ')
          .toLowerCase()
          .includes(keyword);
      });
    },
    [dashboardDateFilter, dashboardFilter, dashboardRows, dashboardSearch, masterLocations],
  );

  const integrityIssues = useMemo<IntegrityIssue[]>(() => {
    const issues: IntegrityIssue[] = [];
    const truckDateAssignments = new Map<string, Delivery[]>();

    if (masterTrucks.length === 0) {
      issues.push({
        id: 'no-trucks',
        message: 'トラックマスターが未登録です。',
        target: 'trucks',
      });
    }

    if (departureLocations.length === 0) {
      issues.push({
        id: 'no-departures',
        message: '出発地マスターが未登録です。',
        target: 'locations',
      });
    }

    if (destinationLocations.length === 0) {
      issues.push({
        id: 'no-destinations',
        message: '向け地マスターが未登録です。',
        target: 'locations',
      });
    }

    deliveries.forEach((delivery) => {
      const truckDateKey = `${delivery.date}-${delivery.truckId}`;
      truckDateAssignments.set(truckDateKey, [...(truckDateAssignments.get(truckDateKey) ?? []), delivery]);

      if (!masterTrucks.some((truck) => truck.id === delivery.truckId)) {
        issues.push({
          id: `${delivery.id}-truck`,
          message: `${delivery.date} の配車が存在しないトラックを参照しています。`,
          target: 'planning',
          deliveryId: delivery.id,
        });
      }

      if (!masterLocations.some((location) => location.id === delivery.departureLocationId)) {
        issues.push({
          id: `${delivery.id}-departure`,
          message: `${delivery.date} の配車が存在しない出発地を参照しています。`,
          target: 'planning',
          deliveryId: delivery.id,
        });
      }

      const routes = deliveryRoutes
        .filter((routeItem) => routeItem.deliveryId === delivery.id)
        .sort((a, b) => a.order - b.order);
      const routeLocationCounts = new Map<string, number>();

      if (routes.length === 0) {
        issues.push({
          id: `${delivery.id}-routes-empty`,
          message: `${delivery.date} の配車に向け地がありません。`,
          target: 'planning',
          deliveryId: delivery.id,
        });
      }

      routes.forEach((routeItem, index) => {
        routeLocationCounts.set(routeItem.locationId, (routeLocationCounts.get(routeItem.locationId) ?? 0) + 1);

        if (routeItem.order !== index + 1) {
          issues.push({
            id: `${routeItem.id}-order`,
            message: `${delivery.date} の配送順序が連番ではありません。`,
            target: 'planning',
            deliveryId: delivery.id,
          });
        }

        if (!masterLocations.some((location) => location.id === routeItem.locationId)) {
          issues.push({
            id: `${routeItem.id}-location`,
            message: `${delivery.date} の配送順が存在しない向け地を参照しています。`,
            target: 'planning',
            deliveryId: delivery.id,
          });
        }

        if (routeItem.locationId === delivery.departureLocationId) {
          issues.push({
            id: `${routeItem.id}-same-departure`,
            message: `${delivery.date} の配送順に出発地と同じ拠点が含まれています。`,
            target: 'planning',
            deliveryId: delivery.id,
          });
        }
      });

      routeLocationCounts.forEach((count, locationId) => {
        if (count > 1) {
          issues.push({
            id: `${delivery.id}-${locationId}-duplicate-stop`,
            message: `${delivery.date} の配車で同じ向け地が複数回指定されています。`,
            target: 'planning',
            deliveryId: delivery.id,
          });
        }
      });
    });

    truckDateAssignments.forEach((assignedDeliveries) => {
      if (assignedDeliveries.length < 2) {
        return;
      }

      const firstDelivery = assignedDeliveries[0];
      const truck = masterTrucks.find((item) => item.id === firstDelivery.truckId);
      issues.push({
        id: `${firstDelivery.date}-${firstDelivery.truckId}-duplicate-truck`,
        message: `${firstDelivery.date} に ${truck?.driverName ?? '未設定ドライバー'} / ${
          truck?.vehicleNumber ?? '車番未設定'
        } が ${assignedDeliveries.length}件の配車へ割り当てられています。`,
        target: 'planning',
        deliveryId: firstDelivery.id,
      });
    });

    return issues;
  }, [deliveries, deliveryRoutes, departureLocations, destinationLocations, masterLocations, masterTrucks]);

  useEffect(() => {
    saveTrucks(masterTrucks);
  }, [masterTrucks]);

  useEffect(() => {
    saveLocations(masterLocations);
  }, [masterLocations]);

  useEffect(() => {
    saveDeliveries(deliveries);
  }, [deliveries]);

  useEffect(() => {
    saveDeliveryRoutes(deliveryRoutes);
  }, [deliveryRoutes]);

  useEffect(() => {
    saveDriverReports(driverReports);
  }, [driverReports]);

  useEffect(() => {
    if (!selectedDeliveryId || driverReports.some((report) => report.deliveryId === selectedDeliveryId)) {
      return;
    }

    const now = new Date().toISOString();
    setDriverReports((current) => [
      ...current,
      {
        deliveryId: selectedDeliveryId,
        status: 'not_started',
        ...createMockPosition(selectedDeliveryId),
        lastSyncedAt: now,
        lastReportedAt: now,
        history: [{ status: 'not_started', reportedAt: now }],
      },
    ]);
  }, [driverReports, selectedDeliveryId]);

  useEffect(() => {
    setForm((current) => ({
      ...current,
      truckId: masterTrucks.some((truck) => truck.id === current.truckId)
        ? current.truckId
        : (masterTrucks[0]?.id ?? ''),
      departureLocationId: departureLocations.some(
        (location) => location.id === current.departureLocationId,
      )
        ? current.departureLocationId
        : (departureLocations[0]?.id ?? ''),
      destinationLocationId: destinationLocations.some(
        (location) => location.id === current.destinationLocationId,
      )
        ? current.destinationLocationId
        : (destinationLocations[0]?.id ?? ''),
    }));
  }, [departureLocations, destinationLocations, masterTrucks]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.truckId || !form.departureLocationId || !form.destinationLocationId) {
      return;
    }

    const deliveryId = createId('delivery');
    const delivery: Delivery = {
      id: deliveryId,
      truckId: form.truckId,
      departureLocationId: form.departureLocationId,
      date: form.date,
      isNightBeforeLoaded: form.isNightBeforeLoaded,
      useExpressway: form.useExpressway,
      bufferMinutes: form.bufferMinutes,
    };

    const nextRoute: DeliveryRoute = {
      id: createId('route'),
      deliveryId,
      locationId: form.destinationLocationId,
      order: 1,
    };

    setDeliveries((current) => [delivery, ...current]);
    setDeliveryRoutes((current) => [nextRoute, ...current]);
    setSelectedDeliveryId(deliveryId);
  }

  function removeDelivery(deliveryId: string) {
    const remainingDeliveries = deliveries.filter((delivery) => delivery.id !== deliveryId);
    setDeliveries(remainingDeliveries);
    setDeliveryRoutes((current) =>
      current.filter((routeItem) => routeItem.deliveryId !== deliveryId),
    );
    setDriverReports((current) => current.filter((report) => report.deliveryId !== deliveryId));

    if (selectedDeliveryId === deliveryId) {
      setSelectedDeliveryId(remainingDeliveries[0]?.id ?? '');
    }
  }

  function duplicateDelivery(deliveryId: string) {
    const sourceDelivery = deliveries.find((delivery) => delivery.id === deliveryId);
    if (!sourceDelivery) {
      return;
    }

    const nextDeliveryId = createId('delivery');
    const sourceRoutes = deliveryRoutes
      .filter((routeItem) => routeItem.deliveryId === deliveryId)
      .sort((a, b) => a.order - b.order);
    const nextDelivery: Delivery = {
      ...sourceDelivery,
      id: nextDeliveryId,
      date: getNextDate(sourceDelivery.date),
    };
    const nextRoutes = sourceRoutes.map((routeItem, index) => ({
      ...routeItem,
      id: createId('route'),
      deliveryId: nextDeliveryId,
      order: index + 1,
    }));
    const now = new Date().toISOString();

    setDeliveries((current) => [nextDelivery, ...current]);
    setDeliveryRoutes((current) => [...nextRoutes, ...current]);
    setDriverReports((current) => [
      {
        deliveryId: nextDeliveryId,
        status: 'not_started',
        ...createMockPosition(nextDeliveryId),
        lastSyncedAt: now,
        lastReportedAt: now,
        history: [{ status: 'not_started', reportedAt: now }],
      },
      ...current,
    ]);
    setSelectedDeliveryId(nextDeliveryId);
    setActiveView('planning');
  }

  function addDestination(locationId: string) {
    if (!selectedDeliveryId) {
      return;
    }

    const nextOrder = selectedRoutes.length + 1;
    const routeItem: DeliveryRoute = {
      id: createId('route'),
      deliveryId: selectedDeliveryId,
      locationId,
      order: nextOrder,
    };

    setDeliveryRoutes((current) => [...current, routeItem]);
    touchDriverSync(selectedDeliveryId);
  }

  function moveRoute(routeId: string, direction: -1 | 1) {
    const targetIndex = selectedRoutes.findIndex((routeItem) => routeItem.id === routeId);
    const swapIndex = targetIndex + direction;
    if (targetIndex < 0 || swapIndex < 0 || swapIndex >= selectedRoutes.length) {
      return;
    }

    const reordered = [...selectedRoutes];
    const target = reordered[targetIndex];
    reordered[targetIndex] = reordered[swapIndex];
    reordered[swapIndex] = target;

    const normalized = reordered.map((routeItem, index) => ({
      ...routeItem,
      order: index + 1,
    }));

    setDeliveryRoutes((current) => [
      ...current.filter((routeItem) => routeItem.deliveryId !== selectedDeliveryId),
      ...normalized,
    ]);
    touchDriverSync(selectedDeliveryId);
  }

  function removeRouteStop(routeId: string) {
    if (!selectedDeliveryId) {
      return;
    }

    const normalized = selectedRoutes
      .filter((routeItem) => routeItem.id !== routeId)
      .map((routeItem, index) => ({ ...routeItem, order: index + 1 }));

    setDeliveryRoutes((current) => [
      ...current.filter((routeItem) => routeItem.deliveryId !== selectedDeliveryId),
      ...normalized,
    ]);
    touchDriverSync(selectedDeliveryId);
  }

  function optimizeSelectedRoute() {
    if (!selectedDeliveryId || !selectedTruck || selectedRoutes.length < 2) {
      setOptimizationNote('最適化には2件以上の向け地が必要です。');
      return;
    }

    const optimized = [...selectedRoutes]
      .sort((a, b) => {
        const locationA = masterLocations.find((location) => location.id === a.locationId);
        const locationB = masterLocations.find((location) => location.id === b.locationId);
        return (
          scoreRouteForDriver(a, locationA, selectedTruck) -
          scoreRouteForDriver(b, locationB, selectedTruck)
        );
      })
      .map((routeItem, index) => ({ ...routeItem, order: index + 1 }));

    setDeliveryRoutes((current) => [
      ...current.filter((routeItem) => routeItem.deliveryId !== selectedDeliveryId),
      ...optimized,
    ]);
    touchDriverSync(selectedDeliveryId);
    setOptimizationNote(`${selectedTruck.driverName} の傾向を加味して順序を更新しました。`);
  }

  function updateSelectedDelivery(patch: Partial<Delivery>) {
    if (!selectedDeliveryId) {
      return;
    }

    setDeliveries((current) =>
      current.map((delivery) =>
        delivery.id === selectedDeliveryId ? { ...delivery, ...patch } : delivery,
      ),
    );
    touchDriverSync(selectedDeliveryId);
  }

  function touchDriverSync(deliveryId: string) {
    const now = new Date().toISOString();
    setDriverReports((current) =>
      current.map((report) =>
        report.deliveryId === deliveryId ? { ...report, lastSyncedAt: now } : report,
      ),
    );
  }

  function updateDriverStatus(status: DeliveryStatus) {
    if (!selectedDeliveryId) {
      return;
    }

    updateDriverStatusForDelivery(selectedDeliveryId, status);
  }

  function updateDriverStatusForDelivery(deliveryId: string, status: DeliveryStatus) {
    const now = new Date().toISOString();
    setDriverReports((current) => {
      const hasReport = current.some((report) => report.deliveryId === deliveryId);
      if (!hasReport) {
        return [
          ...current,
          {
            deliveryId,
            status,
            ...createMockPosition(deliveryId),
            lastSyncedAt: now,
            lastReportedAt: now,
            history: [{ status, reportedAt: now }],
          },
        ];
      }

      return current.map((report) =>
        report.deliveryId === deliveryId
          ? {
              ...report,
              status,
              lastReportedAt: now,
              lastSyncedAt: now,
              history: [...(report.history ?? []), { status, reportedAt: now }],
            }
          : report,
      );
    });
  }

  function refreshDriverPosition() {
    if (!selectedDeliveryId) {
      return;
    }

    const now = new Date().toISOString();
    setDriverReports((current) =>
      current.map((report) =>
        report.deliveryId === selectedDeliveryId
          ? { ...report, ...createMockPosition(`${selectedDeliveryId}-${now}`), lastSyncedAt: now }
          : report,
      ),
    );
  }

  function handleTruckSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const companyName = truckForm.companyName.trim();
    const driverName = truckForm.driverName.trim();
    const vehicleNumber = truckForm.vehicleNumber.trim();
    if (!companyName || !driverName || !vehicleNumber) {
      return;
    }

    const truck: Truck = {
      id: createId('truck'),
      companyName,
      driverName,
      vehicleNumber,
      maxLoadKg: Math.max(1, truckForm.maxLoadKg),
      driverKnowledge: truckForm.driverKnowledge.trim() || '標準ルートを優先する',
    };

    setMasterTrucks((current) => [...current, truck]);
    setTruckForm(createDefaultTruckForm());
  }

  function updateTruck(truckId: string, patch: Partial<Truck>) {
    setMasterTrucks((current) =>
      current.map((truck) => (truck.id === truckId ? { ...truck, ...patch } : truck)),
    );
  }

  function removeTruck(truckId: string) {
    const isReferenced = deliveries.some((delivery) => delivery.truckId === truckId);
    if (isReferenced) {
      return;
    }

    setMasterTrucks((current) => current.filter((truck) => truck.id !== truckId));
  }

  function handleLocationSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const postalCode = locationForm.postalCode.trim();
    const address = locationForm.address.trim();
    const phoneNumber = locationForm.phoneNumber.trim();
    if (!postalCode || !address || !phoneNumber) {
      return;
    }

    const location: Location = {
      id: createId('loc'),
      type: locationForm.type,
      postalCode,
      address,
      phoneNumber,
    };

    setMasterLocations((current) => [...current, location]);
    setLocationForm(createDefaultLocationForm());
  }

  function updateLocation(locationId: string, patch: Partial<Location>) {
    setMasterLocations((current) =>
      current.map((location) =>
        location.id === locationId ? { ...location, ...patch } : location,
      ),
    );
  }

  function removeLocation(locationId: string) {
    const usedAsDeparture = deliveries.some(
      (delivery) => delivery.departureLocationId === locationId,
    );
    const usedAsRoute = deliveryRoutes.some((routeItem) => routeItem.locationId === locationId);
    if (usedAsDeparture || usedAsRoute) {
      return;
    }

    setMasterLocations((current) => current.filter((location) => location.id !== locationId));
  }

  function exportBackup() {
    const payload: BackupPayload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      trucks: masterTrucks,
      locations: masterLocations,
      deliveries,
      deliveryRoutes,
      driverReports,
    };

    setBackupText(JSON.stringify(payload, null, 2));
    setBackupMessage('現在のデータをJSONとしてエクスポートしました。');
  }

  function importBackup() {
    try {
      const payload = JSON.parse(backupText) as Partial<BackupPayload>;
      if (
        payload.version !== 1 ||
        !Array.isArray(payload.trucks) ||
        !Array.isArray(payload.locations) ||
        !Array.isArray(payload.deliveries) ||
        !Array.isArray(payload.deliveryRoutes) ||
        !Array.isArray(payload.driverReports)
      ) {
        setBackupMessage('復元できません。バックアップJSONの形式を確認してください。');
        return;
      }

      setMasterTrucks(payload.trucks);
      setMasterLocations(payload.locations);
      setDeliveries(payload.deliveries);
      setDeliveryRoutes(payload.deliveryRoutes);
      setDriverReports(payload.driverReports);
      setSelectedDeliveryId(payload.deliveries[0]?.id ?? '');
      setBackupMessage('バックアップJSONからデータを復元しました。');
    } catch {
      setBackupMessage('JSONを読み込めません。内容を確認してください。');
    }
  }

  function exportDashboardCsv() {
    const headers = [
      '日付',
      '社名',
      'ドライバー',
      '車番',
      '出発地',
      '配送順',
      'ステータス',
      'ETA',
      '高速費',
      '距離',
      'GPS',
      '気象',
      '高速利用',
      '宵積み',
      'バッファ',
    ];

    const rows = filteredDashboardRows.map((row) => {
      const routeNames = row.routes
        .map((routeItem, index) => `${index + 1}. ${findLocationName(routeItem.locationId, masterLocations)}`)
        .join(' / ');

      return [
        row.delivery.date,
        row.truck?.companyName ?? '未設定',
        row.truck?.driverName ?? '未設定',
        row.truck?.vehicleNumber ?? '未設定',
        findLocationName(row.delivery.departureLocationId, masterLocations),
        routeNames || '未設定',
        statusLabels[row.report.status],
        row.simulation ? formatMinutes(row.simulation.etaMinutes) : '未計算',
        row.simulation ? `${row.simulation.costYen}円` : '未計算',
        row.simulation ? `${row.simulation.distanceKm}km` : '未計算',
        `${row.report.latitude}, ${row.report.longitude}`,
        row.simulation?.weatherRisk ?? '未設定',
        row.delivery.useExpressway ? 'あり' : 'なし',
        row.delivery.isNightBeforeLoaded ? 'あり' : 'なし',
        `${row.delivery.bufferMinutes}分`,
      ];
    });

    const csv = [headers, ...rows]
      .map((row) => row.map((value) => escapeCsvValue(value)).join(','))
      .join('\r\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `delivery-dashboard-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function exportDriverHistoryCsv() {
    if (!selectedDelivery || !selectedDriverReport) {
      return;
    }

    const headers = ['配車日', '社名', 'ドライバー', '車番', 'ステータス', '報告日時', '緯度', '経度'];
    const history = selectedDriverReport.history ?? [
      {
        status: selectedDriverReport.status,
        reportedAt: selectedDriverReport.lastReportedAt,
      },
    ];
    const rows = history.map((item) => [
      selectedDelivery.date,
      selectedTruck?.companyName ?? '未設定',
      selectedTruck?.driverName ?? '未設定',
      selectedTruck?.vehicleNumber ?? '未設定',
      statusLabels[item.status],
      new Date(item.reportedAt).toLocaleString('ja-JP'),
      selectedDriverReport.latitude,
      selectedDriverReport.longitude,
    ]);

    const csv = [headers, ...rows]
      .map((row) => row.map((value) => escapeCsvValue(value)).join(','))
      .join('\r\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `driver-history-${selectedDelivery.date}-${selectedTruck?.driverName ?? 'driver'}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="app-shell">
      <header className="top-bar">
        <div>
          <p className="eyebrow">Delivery Planning Console</p>
          <h1>配送管理システム</h1>
        </div>
        <div className="system-status">
          <span>Google Maps Mock</span>
          <span>Weather Mock</span>
          <span>Windy Mock</span>
        </div>
      </header>

      <div className="app-body">
        <aside className="main-menu" aria-label="メインメニュー">
          <div className="menu-heading">メインメニュー</div>
          <button
            className={activeView === 'dashboard' ? 'menu-item is-active' : 'menu-item'}
            type="button"
            onClick={() => setActiveView('dashboard')}
          >
            <BarChart3 aria-hidden="true" size={18} />
            <span>運行ダッシュボード</span>
          </button>
          <button
            className={activeView === 'planning' ? 'menu-item is-active' : 'menu-item'}
            type="button"
            onClick={() => setActiveView('planning')}
          >
            <ClipboardList aria-hidden="true" size={18} />
            <span>配車計画</span>
          </button>
          <button
            className={activeView === 'trucks' ? 'menu-item is-active' : 'menu-item'}
            type="button"
            onClick={() => setActiveView('trucks')}
          >
            <TruckIcon aria-hidden="true" size={18} />
            <span>トラックマスター</span>
          </button>
          <button
            className={activeView === 'driver' ? 'menu-item is-active' : 'menu-item'}
            type="button"
            onClick={() => setActiveView('driver')}
          >
            <Smartphone aria-hidden="true" size={18} />
            <span>ドライバー連携</span>
          </button>
          <button
            className={activeView === 'api' ? 'menu-item is-active' : 'menu-item'}
            type="button"
            onClick={() => setActiveView('api')}
          >
            <CloudSun aria-hidden="true" size={18} />
            <span>外部API連携</span>
          </button>
          <button
            className={activeView === 'data' ? 'menu-item is-active' : 'menu-item'}
            type="button"
            onClick={() => setActiveView('data')}
          >
            <Database aria-hidden="true" size={18} />
            <span>データ管理</span>
          </button>
          <button
            className={activeView === 'locations' ? 'menu-item is-active' : 'menu-item'}
            type="button"
            onClick={() => setActiveView('locations')}
          >
            <MapPin aria-hidden="true" size={18} />
            <span>出発地/向け地マスター</span>
          </button>
        </aside>

        <section className="view-shell">
          {activeView === 'dashboard' && (
            <section className="dashboard-view">
              <section className="panel">
                <div className="panel-heading">
                  <BarChart3 aria-hidden="true" size={20} />
                  <h2>運行ダッシュボード</h2>
                </div>

                <div className="dashboard-content">
                  <div className="dashboard-metrics">
                    <div>
                      <span>本日の配車</span>
                      <strong>{dashboardStats.total}</strong>
                    </div>
                    <div>
                      <span>未出発</span>
                      <strong>{dashboardStats.notStarted}</strong>
                    </div>
                    <div>
                      <span>運行中</span>
                      <strong>{dashboardStats.running}</strong>
                    </div>
                    <div>
                      <span>完了</span>
                      <strong>{dashboardStats.completed}</strong>
                    </div>
                    <div>
                      <span>気象注意</span>
                      <strong>{dashboardStats.weatherRisk}</strong>
                    </div>
                  </div>

                  <div className="dashboard-search">
                    <label>
                      運行検索
                      <input
                        value={dashboardSearch}
                        onChange={(event) => setDashboardSearch(event.target.value)}
                        placeholder="社名、ドライバー、車番、拠点、ステータス"
                      />
                    </label>
                    <label>
                      日付
                      <input
                        type="date"
                        value={dashboardDateFilter}
                        onChange={(event) => setDashboardDateFilter(event.target.value)}
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setDashboardSearch('');
                        setDashboardDateFilter('');
                      }}
                    >
                      解除
                    </button>
                  </div>

                  <div className={integrityIssues.length === 0 ? 'integrity-panel is-clear' : 'integrity-panel'}>
                    <div className="integrity-heading">
                      <span>データ整合性・割当チェック</span>
                      <strong>{integrityIssues.length === 0 ? '正常' : `${integrityIssues.length}件の確認事項`}</strong>
                    </div>
                    {integrityIssues.length === 0 ? (
                      <p>配車計画、マスター、配送順序、トラック割当の参照関係に問題はありません。</p>
                    ) : (
                      <div className="integrity-list">
                        {integrityIssues.map((issue) => (
                          <div className="integrity-item" key={issue.id}>
                            <span>{issue.message}</span>
                            <button
                              type="button"
                              onClick={() => {
                                if (issue.deliveryId) {
                                  setSelectedDeliveryId(issue.deliveryId);
                                }
                                setActiveView(issue.target);
                              }}
                            >
                              確認
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="dashboard-filter-bar" aria-label="運行状況フィルタ">
                    <button
                      className={dashboardFilter === 'all' ? 'is-active' : ''}
                      type="button"
                      onClick={() => setDashboardFilter('all')}
                    >
                      全件
                    </button>
                    <button
                      className={dashboardFilter === 'notStarted' ? 'is-active' : ''}
                      type="button"
                      onClick={() => setDashboardFilter('notStarted')}
                    >
                      未出発
                    </button>
                    <button
                      className={dashboardFilter === 'running' ? 'is-active' : ''}
                      type="button"
                      onClick={() => setDashboardFilter('running')}
                    >
                      運行中
                    </button>
                    <button
                      className={dashboardFilter === 'completed' ? 'is-active' : ''}
                      type="button"
                      onClick={() => setDashboardFilter('completed')}
                    >
                      完了
                    </button>
                    <button
                      className={dashboardFilter === 'weatherRisk' ? 'is-active' : ''}
                      type="button"
                      onClick={() => setDashboardFilter('weatherRisk')}
                    >
                      気象注意
                    </button>
                    <span>{filteredDashboardRows.length}件表示</span>
                  </div>

                  <div className="dashboard-actions">
                    <button type="button" onClick={exportDashboardCsv} disabled={filteredDashboardRows.length === 0}>
                      <Download aria-hidden="true" size={18} />
                      <span>表示中のCSVを出力</span>
                    </button>
                  </div>

                  <div className="operations-table" role="table" aria-label="運行状況一覧">
                    <div className="operations-row operations-head" role="row">
                      <span>日付</span>
                      <span>ドライバー</span>
                      <span>ステータス</span>
                      <span>ETA/高速費</span>
                      <span>GPS</span>
                      <span>気象</span>
                      <span>操作</span>
                    </div>

                    {filteredDashboardRows.map((row) => (
                      <div className="operations-row" key={row.delivery.id} role="row">
                        <span>{row.delivery.date}</span>
                        <strong>{row.truck?.driverName ?? '未設定'}</strong>
                        <span>
                          <select
                            aria-label="運行ステータス"
                            value={row.report.status}
                            onChange={(event) =>
                              updateDriverStatusForDelivery(
                                row.delivery.id,
                                event.target.value as DeliveryStatus,
                              )
                            }
                          >
                            <option value="not_started">{statusLabels.not_started}</option>
                            {statusOrder.map((status) => (
                              <option key={status} value={status}>
                                {statusLabels[status]}
                              </option>
                            ))}
                          </select>
                        </span>
                        <span>
                          {row.simulation ? `${formatMinutes(row.simulation.etaMinutes)} / ${row.simulation.costYen.toLocaleString()}円` : '未計算'}
                        </span>
                        <span>
                          {row.report.latitude}, {row.report.longitude}
                        </span>
                        <span>{row.simulation?.weatherRisk ?? '未設定'}</span>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedDeliveryId(row.delivery.id);
                            setActiveView('planning');
                          }}
                        >
                          調整
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            </section>
          )}

          {activeView === 'planning' && (
            <section className="workspace">
        <aside className="panel schedule-panel">
          <div className="panel-heading">
            <CalendarDays aria-hidden="true" size={20} />
            <h2>配車計画</h2>
          </div>

          <form className="planning-form" onSubmit={handleSubmit}>
            <label>
              日付
              <input
                type="date"
                value={form.date}
                onInput={(event) => {
                  const nextDate = event.currentTarget.value;
                  setForm((current) => ({
                    ...current,
                    date: nextDate,
                  }));
                }}
                onChange={(event) => setForm((current) => ({ ...current, date: event.target.value }))}
              />
            </label>

            <label>
              トラック
              <select
                value={form.truckId}
                onChange={(event) =>
                  setForm((current) => ({ ...current, truckId: event.target.value }))
                }
              >
                {masterTrucks.map((truck) => (
                  <option key={truck.id} value={truck.id}>
                    {truck.companyName} / {truck.driverName} / {truck.vehicleNumber}
                  </option>
                ))}
              </select>
            </label>

            <label>
              出発地
              <select
                value={form.departureLocationId}
                onChange={(event) =>
                  setForm((current) => ({ ...current, departureLocationId: event.target.value }))
                }
              >
                {departureLocations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.address}
                  </option>
                ))}
              </select>
            </label>

            <label>
              到着地
              <select
                value={form.destinationLocationId}
                onChange={(event) =>
                  setForm((current) => ({ ...current, destinationLocationId: event.target.value }))
                }
              >
                {destinationLocations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.address}
                  </option>
                ))}
              </select>
            </label>

            <div className="field-grid">
              <label className="check-field">
                <input
                  type="checkbox"
                  checked={form.isNightBeforeLoaded}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      isNightBeforeLoaded: event.target.checked,
                    }))
                  }
                />
                宵積み
              </label>

              <label className="check-field">
                <input
                  type="checkbox"
                  checked={form.useExpressway}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, useExpressway: event.target.checked }))
                  }
                />
                高速利用
              </label>
            </div>

            <fieldset className="segmented">
              <legend>バッファ時間</legend>
              <button
                type="button"
                className={form.bufferMinutes === 15 ? 'is-active' : ''}
                onClick={() => setForm((current) => ({ ...current, bufferMinutes: 15 }))}
              >
                15分
              </button>
              <button
                type="button"
                className={form.bufferMinutes === 30 ? 'is-active' : ''}
                onClick={() => setForm((current) => ({ ...current, bufferMinutes: 30 }))}
              >
                30分
              </button>
            </fieldset>

            <button className="primary-button" type="submit">
              <Plus aria-hidden="true" size={18} />
              計画を追加
            </button>
          </form>

          <div className="delivery-search">
            <label>
              配車検索
              <input
                value={deliverySearch}
                onChange={(event) => setDeliverySearch(event.target.value)}
                placeholder="社名、ドライバー、車番、拠点"
              />
            </label>
            <label>
              日付
              <input
                type="date"
                value={deliveryDateFilter}
                onChange={(event) => setDeliveryDateFilter(event.target.value)}
              />
            </label>
            <button
              type="button"
              onClick={() => {
                setDeliverySearch('');
                setDeliveryDateFilter('');
              }}
            >
              解除
            </button>
            <span>{filteredDeliveries.length}件</span>
          </div>

          <div className="delivery-list">
            {filteredDeliveries.map((delivery) => {
              const truck = masterTrucks.find((item) => item.id === delivery.truckId);
              return (
                <div
                  className={delivery.id === selectedDeliveryId ? 'delivery-item is-selected' : 'delivery-item'}
                  key={delivery.id}
                >
                  <button
                    className="delivery-select-button"
                    type="button"
                    onClick={() => setSelectedDeliveryId(delivery.id)}
                  >
                    <span>{delivery.date}</span>
                    <strong>{truck?.driverName ?? '未設定'}</strong>
                  </button>
                  <button
                    aria-label="配車計画を複製"
                    className="delivery-copy-button"
                    title="配車計画を複製"
                    type="button"
                    onClick={() => duplicateDelivery(delivery.id)}
                  >
                    <Copy aria-hidden="true" size={16} />
                  </button>
                  <button
                    aria-label="配車計画を削除"
                    className="delivery-delete-button"
                    title="配車計画を削除"
                    type="button"
                    onClick={() => removeDelivery(delivery.id)}
                  >
                    <Trash2 aria-hidden="true" size={16} />
                  </button>
                </div>
              );
            })}
            {filteredDeliveries.length === 0 && (
              <p className="delivery-empty">条件に一致する配車計画はありません。</p>
            )}
          </div>
        </aside>

        <section className="panel route-panel">
          <div className="panel-heading">
            <Route aria-hidden="true" size={20} />
            <h2>ルート調整</h2>
          </div>

          {selectedDelivery ? (
            <>
              <div className="route-edit-grid">
                <label>
                  配車日
                  <input
                    type="date"
                    value={selectedDelivery.date}
                    onInput={(event) => {
                      const nextDate = event.currentTarget.value;
                      updateSelectedDelivery({ date: nextDate });
                    }}
                    onChange={(event) => updateSelectedDelivery({ date: event.target.value })}
                  />
                </label>
                <label>
                  トラック
                  <select
                    value={selectedDelivery.truckId}
                    onChange={(event) => updateSelectedDelivery({ truckId: event.target.value })}
                  >
                    {masterTrucks.map((truck) => (
                      <option key={truck.id} value={truck.id}>
                        {truck.companyName} / {truck.driverName} / {truck.vehicleNumber}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  出発地
                  <select
                    value={selectedDelivery.departureLocationId}
                    onChange={(event) =>
                      updateSelectedDelivery({ departureLocationId: event.target.value })
                    }
                  >
                    {departureLocations.map((location) => (
                      <option key={location.id} value={location.id}>
                        {location.address}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="toggle-row">
                <label className="check-field">
                  <input
                    type="checkbox"
                    checked={selectedDelivery.isNightBeforeLoaded}
                    onChange={(event) =>
                      updateSelectedDelivery({ isNightBeforeLoaded: event.target.checked })
                    }
                  />
                  宵積み
                </label>
                <label className="check-field">
                  <input
                    type="checkbox"
                    checked={selectedDelivery.useExpressway}
                    onChange={(event) => updateSelectedDelivery({ useExpressway: event.target.checked })}
                  />
                  高速利用
                </label>
                <select
                  value={selectedDelivery.bufferMinutes}
                  onChange={(event) =>
                    updateSelectedDelivery({ bufferMinutes: Number(event.target.value) as 15 | 30 })
                  }
                >
                  <option value={15}>15分バッファ</option>
                  <option value={30}>30分バッファ</option>
                </select>
              </div>

              <div className="optimization-panel">
                <div>
                  <span>AIルート最適化</span>
                  <strong>{optimizationNote}</strong>
                </div>
                <button type="button" onClick={optimizeSelectedRoute}>
                  <Sparkles aria-hidden="true" size={18} />
                  推奨順に並べ替え
                </button>
              </div>

              <ol className="route-list">
                {selectedRoutes.map((routeItem, index) => (
                  <li key={routeItem.id}>
                    <div className="route-index">{index + 1}</div>
                    <div className="route-address">{findLocationName(routeItem.locationId, masterLocations)}</div>
                    <div className="route-actions">
                      <button
                        aria-label="順序を上げる"
                        disabled={index === 0}
                        title="順序を上げる"
                        type="button"
                        onClick={() => moveRoute(routeItem.id, -1)}
                      >
                        <ArrowUp aria-hidden="true" size={17} />
                      </button>
                      <button
                        aria-label="順序を下げる"
                        disabled={index === selectedRoutes.length - 1}
                        title="順序を下げる"
                        type="button"
                        onClick={() => moveRoute(routeItem.id, 1)}
                      >
                        <ArrowDown aria-hidden="true" size={17} />
                      </button>
                      <button
                        aria-label="向け地を削除"
                        title="向け地を削除"
                        type="button"
                        onClick={() => removeRouteStop(routeItem.id)}
                      >
                        <Trash2 aria-hidden="true" size={17} />
                      </button>
                    </div>
                  </li>
                ))}
              </ol>

              <div className="add-stop-row">
                <select
                  aria-label="追加する向け地"
                  onChange={(event) => {
                    if (event.target.value) {
                      addDestination(event.target.value);
                      event.target.value = '';
                    }
                  }}
                  defaultValue=""
                >
                  <option value="" disabled>
                    向け地を追加
                  </option>
                  {destinationLocations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.address}
                    </option>
                  ))}
                </select>
              </div>

              <div className="map-preview">
                <div className="map-preview-heading">
                  <span>Google Maps Mock</span>
                  <strong>ルート地図プレビュー</strong>
                </div>
                <div className="map-canvas" aria-label="ルート地図プレビュー">
                  <div className="map-line" />
                  {[
                    {
                      id: selectedDelivery.departureLocationId,
                      label: '出',
                      name: findLocationName(selectedDelivery.departureLocationId, masterLocations),
                    },
                    ...selectedRoutes.map((routeItem, index) => ({
                      id: routeItem.locationId,
                      label: String(index + 1),
                      name: findLocationName(routeItem.locationId, masterLocations),
                    })),
                  ].map((point, index, points) => {
                    const position = createMapPoint(point.id, index, points.length);
                    return (
                      <div
                        className={index === 0 ? 'map-marker is-start' : 'map-marker'}
                        key={`${point.id}-${index}`}
                        style={{ left: `${position.left}%`, top: `${position.top}%` }}
                        title={point.name}
                      >
                        {point.label}
                      </div>
                    );
                  })}
                </div>
              </div>

              <section className="dispatch-sheet" aria-label="配車指示書">
                <div className="dispatch-sheet-heading">
                  <div>
                    <span>Dispatch Sheet</span>
                    <h3>配車指示書</h3>
                  </div>
                  <button type="button" onClick={() => window.print()}>
                    <Printer aria-hidden="true" size={18} />
                    印刷
                  </button>
                </div>

                <div className="dispatch-sheet-grid">
                  <div>
                    <span>配車日</span>
                    <strong>{selectedDelivery.date}</strong>
                  </div>
                  <div>
                    <span>社名</span>
                    <strong>{selectedTruck?.companyName ?? '未設定'}</strong>
                  </div>
                  <div>
                    <span>ドライバー</span>
                    <strong>{selectedTruck?.driverName ?? '未設定'}</strong>
                  </div>
                  <div>
                    <span>車番</span>
                    <strong>{selectedTruck?.vehicleNumber ?? '未設定'}</strong>
                  </div>
                  <div>
                    <span>出発地</span>
                    <strong>{findLocationName(selectedDelivery.departureLocationId, masterLocations)}</strong>
                  </div>
                  <div>
                    <span>配送条件</span>
                    <strong>
                      {selectedDelivery.isNightBeforeLoaded ? '宵積みあり' : '宵積みなし'} /{' '}
                      {selectedDelivery.useExpressway ? '高速利用あり' : '高速利用なし'} /{' '}
                      {selectedDelivery.bufferMinutes}分バッファ
                    </strong>
                  </div>
                  <div>
                    <span>想定時間</span>
                    <strong>{simulation ? formatMinutes(simulation.etaMinutes) : '未計算'}</strong>
                  </div>
                  <div>
                    <span>想定コスト</span>
                    <strong>{simulation ? `${simulation.costYen.toLocaleString()}円` : '未計算'}</strong>
                  </div>
                </div>

                <ol className="dispatch-stop-list">
                  {selectedRoutes.map((routeItem, index) => (
                    <li key={`dispatch-${routeItem.id}`}>
                      <span>{index + 1}</span>
                      <strong>{findLocationName(routeItem.locationId, masterLocations)}</strong>
                    </li>
                  ))}
                </ol>

                <div className="dispatch-note">
                  <span>ドライバーナレッジ</span>
                  <strong>{selectedTruck?.driverKnowledge ?? '未設定'}</strong>
                </div>
              </section>
            </>
          ) : (
            <p className="empty-state">配車計画を追加してください。</p>
          )}
        </section>

        <aside className="panel intelligence-panel">
          <div className="panel-heading">
            <MapPinned aria-hidden="true" size={20} />
            <h2>シミュレーション</h2>
          </div>

          {selectedDelivery && simulation ? (
            <>
              <div className="recommendation">
                <span>ドライバー傾向を加味した推奨</span>
                <strong>{simulation.routeLabel}</strong>
                <p>{selectedTruck?.driverKnowledge ?? '標準ルートを優先する'}</p>
              </div>

              <div className="metric-grid">
                <div>
                  <span>ETA</span>
                  <strong>{formatMinutes(simulation.etaMinutes)}</strong>
                </div>
                <div>
                  <span>距離</span>
                  <strong>{simulation.distanceKm}km</strong>
                </div>
                <div>
                  <span>高速費</span>
                  <strong>{simulation.costYen.toLocaleString()}円</strong>
                </div>
                <div>
                  <span>気象リスク</span>
                  <strong>{simulation.weatherRisk}</strong>
                </div>
              </div>

              {routeComparison && (
                <div className="comparison-panel">
                  <h3>高速利用 比較</h3>
                  <div className="comparison-grid">
                    <div className={selectedDelivery.useExpressway ? 'comparison-card is-active' : 'comparison-card'}>
                      <span>高速あり</span>
                      <strong>{formatMinutes(routeComparison.expressway.etaMinutes)}</strong>
                      <p>{routeComparison.expressway.costYen.toLocaleString()}円 / {routeComparison.expressway.distanceKm}km</p>
                      <small>気象リスク: {routeComparison.expressway.weatherRisk}</small>
                    </div>
                    <div className={!selectedDelivery.useExpressway ? 'comparison-card is-active' : 'comparison-card'}>
                      <span>高速なし</span>
                      <strong>{formatMinutes(routeComparison.localRoad.etaMinutes)}</strong>
                      <p>{routeComparison.localRoad.costYen.toLocaleString()}円 / {routeComparison.localRoad.distanceKm}km</p>
                      <small>気象リスク: {routeComparison.localRoad.weatherRisk}</small>
                    </div>
                  </div>
                </div>
              )}

              <div className="api-panel">
                <h3>外部APIモック</h3>
                <p>Google Maps: ルート最適化とETAをモック算出</p>
                <p>Weather: 配車日の運行リスクをモック判定</p>
                <p>Windy: {simulation.windySummary}</p>
              </div>

              <button className="secondary-button" type="button" onClick={() => saveDeliveryRoutes(deliveryRoutes)}>
                <Save aria-hidden="true" size={18} />
                順序を保存
              </button>
            </>
          ) : (
            <p className="empty-state">シミュレーション対象がありません。</p>
          )}
        </aside>
            </section>
          )}

          {activeView === 'driver' && (
            <section className="driver-workspace">
              <aside className="panel driver-list-panel">
                <div className="panel-heading">
                  <Smartphone aria-hidden="true" size={20} />
                  <h2>ドライバー向け予定</h2>
                </div>
                <div className="delivery-list">
                  {deliveries.map((delivery) => {
                    const truck = masterTrucks.find((item) => item.id === delivery.truckId);
                    const report = driverReports.find((item) => item.deliveryId === delivery.id);
                    return (
                      <button
                        className={
                          delivery.id === selectedDeliveryId
                            ? 'delivery-item is-selected'
                            : 'delivery-item'
                        }
                        key={delivery.id}
                        type="button"
                        onClick={() => setSelectedDeliveryId(delivery.id)}
                      >
                        <span>{delivery.date}</span>
                        <strong>{truck?.driverName ?? '未設定'}</strong>
                        <span>{statusLabels[report?.status ?? 'not_started']}</span>
                      </button>
                    );
                  })}
                </div>
              </aside>

              <section className="panel driver-detail-panel">
                <div className="panel-heading">
                  <Navigation aria-hidden="true" size={20} />
                  <h2>運行報告</h2>
                </div>

                {selectedDelivery && selectedDriverReport ? (
                  <div className="driver-detail">
                    <div className="driver-summary">
                      <div>
                        <span>ドライバー</span>
                        <strong>{selectedTruck?.driverName ?? '未設定'}</strong>
                      </div>
                      <div>
                        <span>車番</span>
                        <strong>{selectedTruck?.vehicleNumber ?? '未設定'}</strong>
                      </div>
                      <div>
                        <span>同期時刻</span>
                        <strong>{new Date(selectedDriverReport.lastSyncedAt).toLocaleString('ja-JP')}</strong>
                      </div>
                      <div>
                        <span>現在ステータス</span>
                        <strong>{statusLabels[selectedDriverReport.status]}</strong>
                      </div>
                    </div>

                    <div className="driver-route-card">
                      <h3>配車予定ルート</h3>
                      <p>出発地: {findLocationName(selectedDelivery.departureLocationId, masterLocations)}</p>
                      <ol className="driver-route-list">
                        {selectedRoutes.map((routeItem, index) => (
                          <li key={routeItem.id}>
                            <span>{index + 1}</span>
                            <strong>{findLocationName(routeItem.locationId, masterLocations)}</strong>
                          </li>
                        ))}
                      </ol>
                    </div>

                    <div className="status-button-grid">
                      {statusOrder.map((status) => (
                        <button
                          className={
                            selectedDriverReport.status === status
                              ? 'status-button is-active'
                              : 'status-button'
                          }
                          key={status}
                          type="button"
                          onClick={() => updateDriverStatus(status)}
                        >
                          {statusLabels[status]}
                        </button>
                      ))}
                    </div>

                    <div className="driver-summary">
                      <div>
                        <span>GPS緯度</span>
                        <strong>{selectedDriverReport.latitude}</strong>
                      </div>
                      <div>
                        <span>GPS経度</span>
                        <strong>{selectedDriverReport.longitude}</strong>
                      </div>
                      <div>
                        <span>最終報告</span>
                        <strong>{new Date(selectedDriverReport.lastReportedAt).toLocaleString('ja-JP')}</strong>
                      </div>
                      <button className="secondary-button inline-button" type="button" onClick={refreshDriverPosition}>
                        <MapPinned aria-hidden="true" size={18} />
                        位置情報を取得
                      </button>
                    </div>

                    <div className="status-history-panel">
                      <div className="status-history-heading">
                        <h3>運行報告履歴</h3>
                        <button type="button" onClick={exportDriverHistoryCsv}>
                          <Download aria-hidden="true" size={16} />
                          CSV出力
                        </button>
                      </div>
                      <div className="status-history-list">
                        {(selectedDriverReport.history ?? [
                          {
                            status: selectedDriverReport.status,
                            reportedAt: selectedDriverReport.lastReportedAt,
                          },
                        ]).map((item, index) => (
                          <div className="status-history-item" key={`${item.status}-${item.reportedAt}-${index}`}>
                            <span>{index + 1}</span>
                            <strong>{statusLabels[item.status]}</strong>
                            <time>{new Date(item.reportedAt).toLocaleString('ja-JP')}</time>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="empty-state">ドライバー連携する配車計画を選択してください。</p>
                )}
              </section>
            </section>
          )}

          {activeView === 'api' && (
            <section className="api-view">
              <section className="panel">
                <div className="panel-heading">
                  <CloudSun aria-hidden="true" size={20} />
                  <h2>外部API連携</h2>
                </div>

                <div className="api-integration-content">
                  <div className="api-status-grid">
                    <div>
                      <span>Google Maps Platform</span>
                      <strong>Mock Active</strong>
                      <p>地図表示、ルート最適化、ETA取得をモック算出します。</p>
                    </div>
                    <div>
                      <span>気象情報API</span>
                      <strong>Mock Active</strong>
                      <p>配車当日の運行リスクを、目的地と高速利用条件から判定します。</p>
                    </div>
                    <div>
                      <span>Windy.com API</span>
                      <strong>Mock Active</strong>
                      <p>風況とライブカメラ相当の現場コメントを表示します。</p>
                    </div>
                  </div>

                  <div className="api-signal-layout">
                    <aside className="api-delivery-list">
                      <h3>対象配車</h3>
                      <div className="delivery-list compact-list">
                        {deliveries.map((delivery) => {
                          const truck = masterTrucks.find((item) => item.id === delivery.truckId);
                          return (
                            <button
                              className={
                                delivery.id === selectedDeliveryId
                                  ? 'delivery-item is-selected'
                                  : 'delivery-item'
                              }
                              key={delivery.id}
                              type="button"
                              onClick={() => setSelectedDeliveryId(delivery.id)}
                            >
                              <span>{delivery.date}</span>
                              <strong>{truck?.driverName ?? '未設定'}</strong>
                            </button>
                          );
                        })}
                      </div>
                    </aside>

                    <section className="api-signal-panel">
                      {selectedDelivery && simulation ? (
                        <>
                          <div className="api-map-card">
                            <span>Google Maps Mock</span>
                            <strong>{simulation.routeLabel}</strong>
                            <p>ETA: {formatMinutes(simulation.etaMinutes)}</p>
                            <p>距離: {simulation.distanceKm}km</p>
                          </div>

                          <div className="api-map-card">
                            <span>Weather Mock</span>
                            <strong>気象リスク: {simulation.weatherRisk}</strong>
                            <p>{selectedDelivery.date} の配送条件で判定</p>
                            <p>高速利用: {selectedDelivery.useExpressway ? 'あり' : 'なし'}</p>
                          </div>

                          <div className="api-map-card wide-api-card">
                            <span>Windy Mock</span>
                            <strong>{simulation.windySummary}</strong>
                            <div className="windy-camera">
                              <div>Live Camera Mock</div>
                              <p>現場映像はモック表示です。APIキー設定後に実映像へ差し替え可能です。</p>
                            </div>
                          </div>
                        </>
                      ) : (
                        <p className="empty-state">API連携対象の配車計画を選択してください。</p>
                      )}
                    </section>
                  </div>
                </div>
              </section>
            </section>
          )}

          {activeView === 'data' && (
            <section className="panel data-management-panel">
              <div className="panel-heading">
                <Database aria-hidden="true" size={20} />
                <h2>データ管理</h2>
              </div>

              <div className="data-management-content">
                <div className="backup-summary-grid">
                  <div>
                    <span>トラック</span>
                    <strong>{masterTrucks.length}</strong>
                  </div>
                  <div>
                    <span>拠点</span>
                    <strong>{masterLocations.length}</strong>
                  </div>
                  <div>
                    <span>配車</span>
                    <strong>{deliveries.length}</strong>
                  </div>
                  <div>
                    <span>ルート</span>
                    <strong>{deliveryRoutes.length}</strong>
                  </div>
                  <div>
                    <span>報告</span>
                    <strong>{driverReports.length}</strong>
                  </div>
                </div>

                <div className="backup-actions">
                  <button type="button" onClick={exportBackup}>
                    バックアップJSONを作成
                  </button>
                  <button type="button" onClick={importBackup}>
                    JSONから復元
                  </button>
                </div>

                <p className="backup-message">{backupMessage}</p>

                <label className="backup-editor">
                  バックアップJSON
                  <textarea
                    value={backupText}
                    onChange={(event) => setBackupText(event.target.value)}
                    placeholder="バックアップJSONをここに貼り付けると復元できます。"
                  />
                </label>
              </div>
            </section>
          )}

          {activeView === 'trucks' && (
            <section className="panel master-panel">
          <div className="panel-heading">
            <TruckIcon aria-hidden="true" size={20} />
            <h2>トラックマスター</h2>
          </div>

          <form className="master-form truck-master-form" onSubmit={handleTruckSubmit}>
            <label>
              社名
              <input
                required
                value={truckForm.companyName}
                onChange={(event) =>
                  setTruckForm((current) => ({ ...current, companyName: event.target.value }))
                }
              />
            </label>
            <label>
              ドライバー名
              <input
                required
                value={truckForm.driverName}
                onChange={(event) =>
                  setTruckForm((current) => ({ ...current, driverName: event.target.value }))
                }
              />
            </label>
            <label>
              車番
              <input
                required
                value={truckForm.vehicleNumber}
                onChange={(event) =>
                  setTruckForm((current) => ({ ...current, vehicleNumber: event.target.value }))
                }
              />
            </label>
            <label>
              最大積載重量(kg)
              <input
                min={1}
                required
                type="number"
                value={truckForm.maxLoadKg}
                onChange={(event) =>
                  setTruckForm((current) => ({
                    ...current,
                    maxLoadKg: Number(event.target.value),
                  }))
                }
              />
            </label>
            <label className="wide-field">
              ドライバーナレッジ
              <input
                value={truckForm.driverKnowledge}
                onChange={(event) =>
                  setTruckForm((current) => ({ ...current, driverKnowledge: event.target.value }))
                }
              />
            </label>
            <button className="primary-button" type="submit">
              <Plus aria-hidden="true" size={18} />
              トラックを追加
            </button>
          </form>

          <div className="master-search">
            <label>
              トラック検索
              <input
                placeholder="社名・ドライバー名・車番で検索"
                value={truckSearch}
                onChange={(event) => setTruckSearch(event.target.value)}
              />
            </label>
            <span>{filteredMasterTrucks.length} / {masterTrucks.length} 件</span>
          </div>

          <div className="master-list">
            {filteredMasterTrucks.map((truck) => {
              const isReferenced = deliveries.some((delivery) => delivery.truckId === truck.id);
              return (
                <div className="master-row truck-row" key={truck.id}>
                  <input
                    aria-label="社名"
                    value={truck.companyName}
                    onChange={(event) => updateTruck(truck.id, { companyName: event.target.value })}
                  />
                  <input
                    aria-label="ドライバー名"
                    value={truck.driverName}
                    onChange={(event) => updateTruck(truck.id, { driverName: event.target.value })}
                  />
                  <input
                    aria-label="車番"
                    value={truck.vehicleNumber}
                    onChange={(event) => updateTruck(truck.id, { vehicleNumber: event.target.value })}
                  />
                  <input
                    aria-label="最大積載重量"
                    min={1}
                    type="number"
                    value={truck.maxLoadKg}
                    onChange={(event) =>
                      updateTruck(truck.id, { maxLoadKg: Math.max(1, Number(event.target.value)) })
                    }
                  />
                  <input
                    aria-label="ドライバーナレッジ"
                    value={truck.driverKnowledge}
                    onChange={(event) =>
                      updateTruck(truck.id, { driverKnowledge: event.target.value })
                    }
                  />
                  <button
                    aria-label="トラックを削除"
                    disabled={isReferenced}
                    title={isReferenced ? '配車計画で使用中のため削除できません' : 'トラックを削除'}
                    type="button"
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        removeTruck(truck.id);
                      }
                    }}
                    onPointerDown={(event) => {
                      event.preventDefault();
                      removeTruck(truck.id);
                    }}
                  >
                    <Trash2 aria-hidden="true" size={17} />
                  </button>
                </div>
              );
            })}
          </div>
            </section>
          )}

          {activeView === 'locations' && (
            <section className="panel master-panel">
          <div className="panel-heading">
            <MapPinned aria-hidden="true" size={20} />
            <h2>出発地/向け地マスター</h2>
          </div>

          <form className="master-form location-master-form" onSubmit={handleLocationSubmit}>
            <label>
              種別
              <select
                value={locationForm.type}
                onChange={(event) =>
                  setLocationForm((current) => ({
                    ...current,
                    type: event.target.value as LocationType,
                  }))
                }
              >
                <option value="departure">出発地</option>
                <option value="destination">向け地</option>
              </select>
            </label>
            <label>
              郵便番号
              <input
                required
                value={locationForm.postalCode}
                onChange={(event) =>
                  setLocationForm((current) => ({ ...current, postalCode: event.target.value }))
                }
              />
            </label>
            <label className="wide-field">
              住所
              <input
                required
                value={locationForm.address}
                onChange={(event) =>
                  setLocationForm((current) => ({ ...current, address: event.target.value }))
                }
              />
            </label>
            <label>
              電話番号
              <input
                required
                value={locationForm.phoneNumber}
                onChange={(event) =>
                  setLocationForm((current) => ({ ...current, phoneNumber: event.target.value }))
                }
              />
            </label>
            <button className="primary-button" type="submit">
              <Plus aria-hidden="true" size={18} />
              拠点を追加
            </button>
          </form>

          <div className="master-search">
            <label>
              拠点検索
              <input
                placeholder="郵便番号・住所・電話番号で検索"
                value={locationSearch}
                onChange={(event) => setLocationSearch(event.target.value)}
              />
            </label>
            <span>{filteredMasterLocations.length} / {masterLocations.length} 件</span>
          </div>

          <div className="master-list">
            {filteredMasterLocations.map((location) => {
              const isReferenced =
                deliveries.some((delivery) => delivery.departureLocationId === location.id) ||
                deliveryRoutes.some((routeItem) => routeItem.locationId === location.id);
              return (
                <div className="master-row location-row" key={location.id}>
                  <select
                    aria-label="種別"
                    value={location.type}
                    onChange={(event) =>
                      updateLocation(location.id, { type: event.target.value as LocationType })
                    }
                  >
                    <option value="departure">出発地</option>
                    <option value="destination">向け地</option>
                  </select>
                  <input
                    aria-label="郵便番号"
                    value={location.postalCode}
                    onChange={(event) =>
                      updateLocation(location.id, { postalCode: event.target.value })
                    }
                  />
                  <input
                    aria-label="住所"
                    value={location.address}
                    onChange={(event) => updateLocation(location.id, { address: event.target.value })}
                  />
                  <input
                    aria-label="電話番号"
                    value={location.phoneNumber}
                    onChange={(event) =>
                      updateLocation(location.id, { phoneNumber: event.target.value })
                    }
                  />
                  <button
                    aria-label="拠点を削除"
                    disabled={isReferenced}
                    title={isReferenced ? '配車計画で使用中のため削除できません' : '拠点を削除'}
                    type="button"
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        removeLocation(location.id);
                      }
                    }}
                    onPointerDown={(event) => {
                      event.preventDefault();
                      removeLocation(location.id);
                    }}
                  >
                    <Trash2 aria-hidden="true" size={17} />
                  </button>
                </div>
              );
            })}
          </div>
            </section>
          )}
        </section>
      </div>
    </main>
  );
}
