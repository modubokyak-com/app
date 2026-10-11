import {
  PRIVACY_POLICY_EFFECTIVE_DATE,
  PRIVACY_POLICY_INTRO,
  PRIVACY_POLICY_SECTIONS,
} from "../lib/privacyPolicy";

const policyText = [PRIVACY_POLICY_INTRO, ...PRIVACY_POLICY_SECTIONS.flatMap((section) => section.body)].join("\n");

it("identifies the corporate operator and support contact", () => {
  expect(policyText).toContain("주식회사 안팜(AhnPharm Inc.)");
  expect(policyText).toContain("official@modubokyak.com");
});

it("describes pre-login transfer and optional OpenAI flows", () => {
  expect(policyText).toContain("로그인 전 점검도 입력값을 Supabase 서버에 전송");
  expect(policyText).toContain("사진이 Supabase Edge Function을 거쳐 OpenAI로 전송");
  expect(policyText).toContain("약 이름이 같은 경로로 OpenAI에 전송");
});

it("does not claim Apple email collection or universal immediate deletion", () => {
  expect(policyText).not.toContain("Apple은 회원 식별값과 사용자가 허용한 이름·이메일");
  expect(policyText).not.toContain("즉시 삭제");
  expect(policyText).not.toContain("복구할 수 없습니다");
});

it("matches the deployed policy effective date under review", () => {
  expect(PRIVACY_POLICY_EFFECTIVE_DATE).toBe("2026년 10월 11일");
});
