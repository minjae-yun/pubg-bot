import { SlashCommandBuilder } from "discord.js";

export const statsCommand = new SlashCommandBuilder()
  .setName("전적")
  .setDescription("PUBG PC/Steam 평생 전적을 검색합니다.")
  .addStringOption((option) =>
    option
      .setName("닉네임")
      .setDescription("/등록한 내 닉네임이 자동완성됩니다.")
      .setRequired(true)
      .setAutocomplete(true)
      .setMinLength(1)
      .setMaxLength(30),
  )
  .addStringOption((option) =>
    option
      .setName("모드")
      .setDescription("확인할 게임 모드(기본값: 스쿼드 TPP)")
      .setRequired(false)
      .addChoices(
        { name: "스쿼드 TPP", value: "squad" },
        { name: "듀오 TPP", value: "duo" },
        { name: "솔로 TPP", value: "solo" },
        { name: "스쿼드 FPP", value: "squad-fpp" },
        { name: "듀오 FPP", value: "duo-fpp" },
        { name: "솔로 FPP", value: "solo-fpp" },
      ),
  );

export const recentStatsCommand = new SlashCommandBuilder()
  .setName("최근전적")
  .setDescription("최근 경기 기준 평딜, K/D, KDA를 확인합니다.")
  .addStringOption((option) =>
    option
      .setName("닉네임")
      .setDescription("/등록한 내 닉네임이 자동완성됩니다.")
      .setRequired(true)
      .setAutocomplete(true)
      .setMinLength(1)
      .setMaxLength(30),
  )
  .addStringOption((option) =>
    option
      .setName("모드")
      .setDescription("확인할 게임 모드(기본값: 스쿼드 TPP)")
      .setRequired(false)
      .addChoices(
        { name: "스쿼드 TPP", value: "squad" },
        { name: "스쿼드 FPP", value: "squad-fpp" },
        { name: "듀오 TPP", value: "duo" },
        { name: "듀오 FPP", value: "duo-fpp" },
        { name: "솔로 TPP", value: "solo" },
        { name: "솔로 FPP", value: "solo-fpp" },
      ),
  )
  .addIntegerOption((option) =>
    option
      .setName("경기수")
      .setDescription("계산할 최근 경기 수(기본값: 10경기)")
      .setRequired(false)
      .addChoices(
        { name: "최근 5경기", value: 5 },
        { name: "최근 10경기", value: 10 },
        { name: "최근 20경기", value: 20 },
      ),
  );

export const registerPlayerCommand = new SlashCommandBuilder()
  .setName("등록")
  .setDescription("PUBG 닉네임과 킬내기 표시 이름을 연결합니다.")
  .addStringOption((option) =>
    option
      .setName("닉네임")
      .setDescription("연결할 PUBG PC/Steam 인게임 닉네임")
      .setRequired(true)
      .setMinLength(1)
      .setMaxLength(30),
  )
  .addStringOption((option) =>
    option
      .setName("이름")
      .setDescription("킬내기 시트에 표시할 이름(예: 민재)")
      .setRequired(false)
      .setMinLength(1)
      .setMaxLength(20),
  );

export const partyStartCommand = new SlashCommandBuilder()
  .setName("파티시작")
  .setDescription("지금부터 플레이할 PUBG 파티 기록을 시작합니다.");

export const partySummaryCommand = new SlashCommandBuilder()
  .setName("파티결산")
  .setDescription("현재 파티의 경기 기록과 MVP를 결산합니다.");

export const partyCancelCommand = new SlashCommandBuilder()
  .setName("파티취소")
  .setDescription("경기 기록 없이 현재 파티를 종료합니다.");

export const killRaceStartCommand = new SlashCommandBuilder()
  .setName("킬내기시작")
  .setDescription("일반 파티와 별개로 PUBG 킬내기를 준비합니다.")
  .addStringOption((option) =>
    option
      .setName("모드")
      .setDescription("팀 구성")
      .setRequired(true)
      .addChoices(
        { name: "2대2", value: "2v2" },
        { name: "3대3", value: "3v3" },
        { name: "4대4", value: "4v4" },
        { name: "2대2대2", value: "2v2v2" },
      ),
  )
  .addIntegerOption((option) =>
    option
      .setName("목표점수")
      .setDescription("승리 목표 점수(기본값: 30점)")
      .setRequired(false)
      .setMinValue(1)
      .setMaxValue(200),
  );

export const killRaceStatusCommand = new SlashCommandBuilder()
  .setName("킬내기현황")
  .setDescription("현재 채널의 킬내기 점수를 확인합니다.");

export const killRaceEndCommand = new SlashCommandBuilder()
  .setName("킬내기종료")
  .setDescription("현재 채널의 킬내기를 종료합니다.");

export const commands = [
  statsCommand,
  recentStatsCommand,
  registerPlayerCommand,
  partyStartCommand,
  partySummaryCommand,
  partyCancelCommand,
  killRaceStartCommand,
  killRaceStatusCommand,
  killRaceEndCommand,
];
