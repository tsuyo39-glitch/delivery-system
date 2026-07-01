import type { Delivery, DeliveryRoute, Location, Truck } from './types';

export const trucks: Truck[] = [
  {
    id: 'truck-1',
    companyName: '北都ロジスティクス',
    driverName: '佐藤 健',
    vehicleNumber: '品川 130 あ 1024',
    maxLoadKg: 4200,
    driverKnowledge: '首都高湾岸線を優先し、朝の都心環状線を避ける',
  },
  {
    id: 'truck-2',
    companyName: '東海配送',
    driverName: '鈴木 真由',
    vehicleNumber: '横浜 800 か 2219',
    maxLoadKg: 3500,
    driverKnowledge: '海沿いの強風区間を避け、内陸側の幹線道路を優先する',
  },
  {
    id: 'truck-3',
    companyName: '中央便サービス',
    driverName: '田中 誠',
    vehicleNumber: '多摩 400 さ 7741',
    maxLoadKg: 2800,
    driverKnowledge: '積み下ろし時間が短い拠点を先に回る',
  },
];

export const locations: Location[] = [
  {
    id: 'loc-1',
    type: 'departure',
    postalCode: '135-0064',
    address: '東京都江東区青海2-4-24',
    phoneNumber: '03-0000-1101',
  },
  {
    id: 'loc-2',
    type: 'departure',
    postalCode: '230-0054',
    address: '神奈川県横浜市鶴見区大黒ふ頭15',
    phoneNumber: '045-000-2202',
  },
  {
    id: 'loc-3',
    type: 'destination',
    postalCode: '330-0854',
    address: '埼玉県さいたま市大宮区桜木町1-7',
    phoneNumber: '048-000-3303',
  },
  {
    id: 'loc-4',
    type: 'destination',
    postalCode: '260-0024',
    address: '千葉県千葉市中央区中央港1-20',
    phoneNumber: '043-000-4404',
  },
  {
    id: 'loc-5',
    type: 'destination',
    postalCode: '192-0083',
    address: '東京都八王子市旭町9-1',
    phoneNumber: '042-000-5505',
  },
];

export const initialDeliveries: Delivery[] = [
  {
    id: 'delivery-1',
    truckId: 'truck-1',
    departureLocationId: 'loc-1',
    date: new Date().toISOString().slice(0, 10),
    isNightBeforeLoaded: true,
    useExpressway: true,
    bufferMinutes: 15,
  },
];

export const initialDeliveryRoutes: DeliveryRoute[] = [
  { id: 'route-1', deliveryId: 'delivery-1', locationId: 'loc-3', order: 1 },
  { id: 'route-2', deliveryId: 'delivery-1', locationId: 'loc-4', order: 2 },
  { id: 'route-3', deliveryId: 'delivery-1', locationId: 'loc-5', order: 3 },
];
