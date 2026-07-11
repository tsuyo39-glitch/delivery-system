import { describe, expect, it } from 'vitest';
import {
  canAddRouteStop,
  hasTruckAssignmentConflict,
  validateBackupPayload,
} from './domain';

const validBackup = {
  version: 1 as const,
  exportedAt: '2026-07-12T00:00:00.000Z',
  trucks: [
    {
      id: 'truck-1',
      companyName: '配送株式会社',
      driverName: '配送 太郎',
      vehicleNumber: '品川 100 あ 12-34',
      maxLoadKg: 2000,
      driverKnowledge: '標準ルート',
    },
  ],
  locations: [
    {
      id: 'departure-1',
      type: 'departure' as const,
      postalCode: '100-0001',
      address: '東京都千代田区千代田1-1',
      phoneNumber: '03-0000-0000',
    },
    {
      id: 'destination-1',
      type: 'destination' as const,
      postalCode: '100-0002',
      address: '東京都千代田区皇居外苑1-1',
      phoneNumber: '03-1111-1111',
    },
  ],
  deliveries: [
    {
      id: 'delivery-1',
      truckId: 'truck-1',
      departureLocationId: 'departure-1',
      date: '2026-07-12',
      isNightBeforeLoaded: false,
      useExpressway: true,
      bufferMinutes: 15 as const,
    },
  ],
  deliveryRoutes: [
    {
      id: 'route-1',
      deliveryId: 'delivery-1',
      locationId: 'destination-1',
      order: 1,
    },
  ],
  driverReports: [
    {
      deliveryId: 'delivery-1',
      status: 'not_started' as const,
      latitude: 35.6812,
      longitude: 139.7671,
      lastSyncedAt: '2026-07-12T00:00:00.000Z',
      lastReportedAt: '2026-07-12T00:00:00.000Z',
      history: [{ status: 'not_started' as const, reportedAt: '2026-07-12T00:00:00.000Z' }],
    },
  ],
};

describe('バックアップJSONの検証', () => {
  it('関連データが揃った完全なバックアップを受理する', () => {
    expect(validateBackupPayload(validBackup)).toBeNull();
  });

  it('存在しないトラックを参照する配車を拒否する', () => {
    const invalidBackup = {
      ...validBackup,
      deliveries: [{ ...validBackup.deliveries[0], truckId: 'missing-truck' }],
    };

    expect(validateBackupPayload(invalidBackup)).toBe(
      '復元できません。存在しないトラックを参照する配車があります。',
    );
  });
});

describe('配車の重複判定', () => {
  it('同じ日付に同じトラックが割り当て済みなら競合と判定する', () => {
    expect(hasTruckAssignmentConflict(validBackup.deliveries, '2026-07-12', 'truck-1')).toBe(true);
  });

  it('日付またはトラックが異なれば競合と判定しない', () => {
    expect(hasTruckAssignmentConflict(validBackup.deliveries, '2026-07-13', 'truck-1')).toBe(false);
    expect(hasTruckAssignmentConflict(validBackup.deliveries, '2026-07-12', 'truck-2')).toBe(false);
  });
});

describe('配送順の重複防止', () => {
  it('同じ配車に登録済みの向け地は追加できない', () => {
    expect(canAddRouteStop(validBackup.deliveryRoutes, 'delivery-1', 'destination-1')).toBe(false);
  });

  it('未登録の向け地は追加できる', () => {
    expect(canAddRouteStop(validBackup.deliveryRoutes, 'delivery-1', 'destination-2')).toBe(true);
  });
});
