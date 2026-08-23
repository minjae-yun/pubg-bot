import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzeTrackedKills,
  countSameSquadKills,
} from "../src/squad-kills.js";

test("한 경기에서 동일한 적 스쿼드의 서로 다른 피해자 수를 계산한다", () => {
  const events = [
    killEvent("account-1", 10, "enemy-1", 20),
    killEvent("account-1", 10, "enemy-2", 20),
    killEvent("account-1", 10, "enemy-3", 20),
    killEvent("account-1", 10, "enemy-4", 30),
  ];

  const result = countSameSquadKills(events, ["account-1"]).get("account-1");

  assert.equal(result.count, 3);
  assert.equal(result.enemyTeamId, "20");
  assert.deepEqual(result.victimAccountIds, ["enemy-1", "enemy-2", "enemy-3"]);
});

test("같은 피해자의 중복 킬 로그와 아군 처치는 제외한다", () => {
  const duplicatedKill = killEvent("account-1", 10, "enemy-1", 20);
  const events = [
    duplicatedKill,
    { ...duplicatedKill },
    killEvent("account-1", 10, "teammate-1", 10),
    killEvent("other-player", 30, "enemy-2", 20),
  ];

  const result = countSameSquadKills(events, ["account-1"]).get("account-1");

  assert.equal(result.count, 1);
  assert.deepEqual(result.victimAccountIds, ["enemy-1"]);
});

test("블루칩으로 재소환된 같은 적을 다시 잡아도 스쿼드 브레이커는 한 명으로 센다", () => {
  const events = [
    killEvent("account-1", 10, "enemy-1", 20),
    killEvent("account-1", 10, "enemy-1", 20),
  ];

  const analysis = analyzeTrackedKills(events, ["account-1"]);

  assert.equal(analysis.killsByPlayer.get("account-1").length, 2);
  assert.equal(analysis.sameSquadKills.get("account-1").count, 1);
});

test("막타 담당자가 달라도 killer에 기록된 플레이어에게 집계한다", () => {
  const event = {
    ...killEvent("account-1", 10, "enemy-1", 20),
    finisher: { accountId: "account-2", teamId: 10 },
  };
  const results = countSameSquadKills([event], ["account-1", "account-2"]);

  assert.equal(results.get("account-1").count, 1);
  assert.equal(results.get("account-2").count, 0);
});

test("토너먼트용 LogPlayerKill도 같은 방식으로 지원한다", () => {
  const event = killEvent("account-1", 10, "enemy-1", 20);
  event._T = "LogPlayerKill";

  assert.equal(
    countSameSquadKills([event], ["account-1"]).get("account-1").count,
    1,
  );
});

test("킬을 만든 무기와 피해 유형을 미션 판정용으로 추출한다", () => {
  const event = {
    ...killEvent("account-1", 10, "enemy-1", 20),
    dBNOMaker: { accountId: "account-1", teamId: 10 },
    dBNODamageInfo: {
      damageCauserName: "PanzerFaust100M_Projectile_C",
      damageTypeCategory: "Damage_Explosion_PanzerFaustWarhead",
      distance: 2_500,
    },
    killerDamageInfo: {
      damageCauserName: "None",
      damageTypeCategory: "Damage_Groggy",
    },
  };

  const analysis = analyzeTrackedKills([event], ["account-1"]);
  const kill = analysis.killsByPlayer.get("account-1")[0];

  assert.equal(kill.damageCauserName, "PanzerFaust100M_Projectile_C");
  assert.equal(kill.damageTypeCategory, "Damage_Explosion_PanzerFaustWarhead");
  assert.equal(kill.distance, 2_500);
});

test("첫 총·보급 무기·플레어건 사용을 시간 순서대로 추출한다", () => {
  const events = [
    pickupEvent(
      "2026-08-23T00:59:59.000Z",
      "LogItemPickup",
      "Item_Weapon_AK47_C",
      "Main",
    ),
    landingEvent("2026-08-23T01:00:00.000Z"),
    pickupEvent(
      "2026-08-23T01:00:01.000Z",
      "LogItemPickup",
      "Item_Weapon_FlareGun_C",
      "Main",
    ),
    pickupEvent(
      "2026-08-23T01:00:02.000Z",
      "LogItemPickup",
      "Item_Weapon_HK416_C",
      "Main",
    ),
    pickupEvent(
      "2026-08-23T01:00:03.000Z",
      "LogItemPickup",
      "Item_Weapon_AK47_C",
      "Main",
    ),
    {
      _D: "2026-08-23T01:00:04.000Z",
      _T: "LogPlayerUseFlareGun",
      attacker: { accountId: "account-1" },
    },
    pickupEvent(
      "2026-08-23T01:00:05.000Z",
      "LogItemPickupFromCarepackage",
      "Item_Weapon_AWM_C",
      "Main",
    ),
  ];

  const telemetry = analyzeTrackedKills(events.reverse(), ["account-1"])
    .playerTelemetry.get("account-1");

  assert.equal(telemetry.firstFirearmKey, "hk416");
  assert.deepEqual([...telemetry.carePackageWeaponKeys], ["awm"]);
  assert.equal(telemetry.flareGunUses, 1);
});

test("첫 총과 킬 로그의 무기 식별자를 같은 값으로 정규화한다", () => {
  const events = [
    landingEvent("2026-08-23T01:00:00.000Z"),
    pickupEvent(
      "2026-08-23T01:00:01.000Z",
      "LogItemPickup",
      "Item_Weapon_AK47_C",
      "Main",
    ),
    {
      ...killEvent("account-1", 10, "enemy-1", 20),
      _D: "2026-08-23T01:02:00.000Z",
      killerDamageInfo: {
        damageCauserName: "WeapAK47_C",
        damageTypeCategory: "Damage_Gun",
      },
    },
  ];
  const analysis = analyzeTrackedKills(events, ["account-1"]);

  assert.equal(analysis.playerTelemetry.get("account-1").firstFirearmKey, "ak47");
  assert.equal(analysis.killsByPlayer.get("account-1")[0].weaponKey, "ak47");
});

test("이름이 다른 모신나강과 Win94 식별자도 첫 총과 연결한다", () => {
  const cases = [
    ["Item_Weapon_Mosin_C", "WeapMosinNagant_C", "mosinnagant"],
    ["Item_Weapon_Win1894_C", "WeapWin94_C", "win94"],
  ];

  for (const [itemId, damageCauserName, expectedKey] of cases) {
    const events = [
      landingEvent("2026-08-23T01:00:00.000Z"),
      pickupEvent("2026-08-23T01:00:01.000Z", "LogItemPickup", itemId, "Main"),
      {
        ...killEvent("account-1", 10, "enemy-1", 20),
        _D: "2026-08-23T01:02:00.000Z",
        killerDamageInfo: {
          damageCauserName,
          damageTypeCategory: "Damage_Gun",
        },
      },
    ];
    const analysis = analyzeTrackedKills(events, ["account-1"]);

    assert.equal(
      analysis.playerTelemetry.get("account-1").firstFirearmKey,
      expectedKey,
    );
    assert.equal(
      analysis.killsByPlayer.get("account-1")[0].weaponKey,
      expectedKey,
    );
  }
});

test("기절 로그를 연결해 차량 탑승 상태의 총기 킬을 구분한다", () => {
  const events = [
    {
      _T: "LogPlayerMakeGroggy",
      dBNOId: 77,
      attackId: 88,
      attacker: { accountId: "account-1", teamId: 10 },
      victim: { accountId: "enemy-1", teamId: 20 },
      isAttackerInVehicle: true,
    },
    {
      ...killEvent("account-1", 10, "enemy-1", 20),
      dBNOId: 77,
      dBNOMaker: { accountId: "account-1", teamId: 10 },
      dBNODamageInfo: {
        damageCauserName: "WeapBerylM762_C",
        damageTypeCategory: "Damage_Gun",
      },
    },
  ];

  const kill = analyzeTrackedKills(events, ["account-1"])
    .killsByPlayer.get("account-1")[0];

  assert.equal(kill.isAttackerInVehicle, true);
  assert.equal(kill.weaponKey, "berylm762");
});

function pickupEvent(date, type, itemId, subCategory) {
  return {
    _D: date,
    _T: type,
    character: { accountId: "account-1" },
    item: {
      itemId,
      category: "Weapon",
      subCategory,
    },
  };
}

function landingEvent(date) {
  return {
    _D: date,
    _T: "LogParachuteLanding",
    character: { accountId: "account-1" },
  };
}

function killEvent(killerId, killerTeamId, victimId, victimTeamId) {
  return {
    _T: "LogPlayerKillV2",
    killer: { accountId: killerId, teamId: killerTeamId },
    victim: { accountId: victimId, teamId: victimTeamId },
  };
}
