import test from "node:test";
import assert from "node:assert/strict";
import { commands, statsCommand } from "../src/commands.js";

test("전적 슬래시 명령어를 Discord JSON 형식으로 만든다", () => {
  const command = statsCommand.toJSON();

  assert.equal(command.name, "전적");
  assert.equal(command.options[0].name, "닉네임");
  assert.equal(command.options[0].required, true);
  assert.equal(command.options[0].autocomplete, true);
  assert.equal(command.options[1].name, "모드");
  assert.equal(command.options[1].choices.length, 6);
});

test("등록과 파티 명령어를 함께 제공한다", () => {
  const commandBodies = commands.map((command) => command.toJSON());

  assert.deepEqual(
    commandBodies.map((command) => command.name),
    [
      "전적",
      "최근전적",
      "등록",
      "파티시작",
      "파티결산",
      "파티취소",
      "킬내기시작",
      "킬내기현황",
      "킬내기종료",
    ],
  );

  const recentCommand = commandBodies.find((command) => command.name === "최근전적");
  assert.equal(recentCommand.options[0].required, true);
  assert.equal(recentCommand.options[0].autocomplete, true);
  assert.equal(recentCommand.options[2].name, "경기수");
  assert.deepEqual(
    recentCommand.options[2].choices.map((choice) => choice.value),
    [5, 10, 20],
  );

  const registerCommand = commandBodies.find(
    (command) => command.name === "등록",
  );
  assert.equal(registerCommand.options[0].name, "닉네임");
  assert.equal(registerCommand.options[0].required, true);
  assert.equal(registerCommand.options[1].name, "이름");
  assert.equal(registerCommand.options[1].required, false);

  const killRaceCommand = commandBodies.find(
    (command) => command.name === "킬내기시작",
  );
  assert.deepEqual(
    killRaceCommand.options[0].choices.map((choice) => choice.value),
    ["2v2", "3v3", "4v4", "2v2v2"],
  );
  assert.equal(killRaceCommand.options[1].name, "목표점수");
});
