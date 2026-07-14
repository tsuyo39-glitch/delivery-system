import { describe, expect, it } from 'vitest';
import {
  buildDeliveryPlanCsvRows,
  canAddRouteStop,
  deliveryPlanCsvHeaders,
  getPlanningMasterWarnings,
  hasTruckAssignmentConflict,
  reorderRouteBefore,
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

describe('配車計画マスター不足の判定', () => {
  it('トラック、出発地、向け地が揃っていれば警告しない', () => {
    expect(getPlanningMasterWarnings(validBackup.trucks, validBackup.locations)).toEqual([]);
  });

  it('不足しているマスターだけ警告する', () => {
    expect(getPlanningMasterWarnings([], [validBackup.locations[1]])).toEqual([
      {
        id: 'trucks',
        label: 'トラックマスターが未登録です。',
        target: 'trucks',
      },
      {
        id: 'departures',
        label: '出発地マスターが未登録です。',
        target: 'locations',
      },
    ]);
  });
});

describe('配車計画CSV行の生成', () => {
  it('配送順をorder順に並べ、配車計画CSVの行を生成する', () => {
    const rows = buildDeliveryPlanCsvRows(
      validBackup.deliveries,
      [
        { id: 'route-2', deliveryId: 'delivery-1', locationId: 'destination-2', order: 2 },
        { id: 'route-1', deliveryId: 'delivery-1', locationId: 'destination-1', order: 1 },
      ],
      [
        ...validBackup.locations,
        {
          id: 'destination-2',
          type: 'destination',
          postalCode: '100-0003',
          address: '東京都千代田区丸の内1-1',
          phoneNumber: '03-2222-2222',
        },
      ],
      validBackup.trucks,
      [{ deliveryId: 'delivery-1', etaLabel: '45分', costLabel: '1200円' }],
    );

    expect(deliveryPlanCsvHeaders).toContain('配送順');
    expect(rows).toEqual([
      [
        'delivery-1',
        '2026-07-12',
        '配送株式会社',
        '配送 太郎',
        '品川 100 あ 12-34',
        '100-0001 東京都千代田区千代田1-1',
        '1. 100-0002 東京都千代田区皇居外苑1-1 / 2. 100-0003 東京都千代田区丸の内1-1',
        '45分',
        '1200円',
        'あり',
        'なし',
        '15分',
      ],
    ]);
  });

  it('参照先が不足している場合は未設定または未計算で行を生成する', () => {
    const rows = buildDeliveryPlanCsvRows(
      [{ ...validBackup.deliveries[0], truckId: 'missing-truck', departureLocationId: 'missing-location' }],
      [],
      validBackup.locations,
      validBackup.trucks,
      [],
    );

    expect(rows[0]).toEqual([
      'delivery-1',
      '2026-07-12',
      '未設定',
      '未設定',
      '未設定',
      '未設定',
      '未設定',
      '未計算',
      '未計算',
      'あり',
      'なし',
      '15分',
    ]);
  });
});

describe('配送順の並べ替え', () => {
  it('先頭の配送先を指定した配送先の直前へ移動し、順序を連番にする', () => {
    const routes = [
      { id: 'route-1', deliveryId: 'delivery-1', locationId: 'destination-1', order: 1 },
      { id: 'route-2', deliveryId: 'delivery-1', locationId: 'destination-2', order: 2 },
      { id: 'route-3', deliveryId: 'delivery-1', locationId: 'destination-3', order: 3 },
    ];

    const reordered = reorderRouteBefore(routes, 'route-1', 'route-3');

    expect(reordered.map(({ id, order }) => ({ id, order }))).toEqual([
      { id: 'route-2', order: 1 },
      { id: 'route-1', order: 2 },
      { id: 'route-3', order: 3 },
    ]);
  });

  it('存在しない配送順IDが指定された場合は元の順序を維持する', () => {
    const routes = [
      { id: 'route-1', deliveryId: 'delivery-1', locationId: 'destination-1', order: 1 },
      { id: 'route-2', deliveryId: 'delivery-1', locationId: 'destination-2', order: 2 },
    ];

    expect(reorderRouteBefore(routes, 'missing-route', 'route-2')).toEqual(routes);
    expect(reorderRouteBefore(routes, 'route-1', 'missing-route')).toEqual(routes);
  });
});
