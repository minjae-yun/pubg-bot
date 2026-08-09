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
  .setDescription("내 디스코드 계정에 PUBG 닉네임을 연결합니다.")
  .addStringOption((option) =>
    option
      .setName("닉네임")
      .setDescription("연결할 PUBG PC/Steam 인게임 닉네임")
      .setRequired(true)
      .setMinLength(1)
      .setMaxLength(30),
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

export const commands = [
  statsCommand,
  recentStatsCommand,
  registerPlayerCommand,
  partyStartCommand,
  partySummaryCommand,
  partyCancelCommand,
];
