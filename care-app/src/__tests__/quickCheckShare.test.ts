import { buildQuickCheckShareMessage, WEB_CHECK_INVITE_URL } from "../lib/quickCheckShare";

describe("buildQuickCheckShareMessage", () => {
  it("1분 점검 소개 + 웹 1분 점검 초대 링크, 분석 결과는 없다", () => {
    const m = buildQuickCheckShareMessage();
    expect(m).toBe(`드시는 약과 영양제 중에 주의가 필요한 조합이 있는지 1분이면 확인해 볼 수 있어요.\n${WEB_CHECK_INVITE_URL}`);
    expect(m).toContain("https://modubokyak.com/check/#invite=1");
    // 기기마다 다른 스토어 링크를 보내지 않는다 — 받는 사람 기기와 안 맞을 수 있다
    expect(m).not.toMatch(/apps\.apple\.com|play\.google\.com/);
    expect(m).not.toMatch(/×/);
    // 안전을 보증하는 표현 금지(스토어 의료 표현 심사)
    expect(m).not.toMatch(/괜찮|안전/);
  });
});
