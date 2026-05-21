/**
 * Referral-code endpoint — `GET /api/referral-code`.
 *
 * Returns the app's Phoenix referral code as plain text (no JSON), so it can be
 * consumed directly with `curl` or any plain-text reader. Hardcoded for now;
 * `GZNNNBK5` is also the onboarding default in `src/auth/OnboardingFlow.tsx`.
 */

export const dynamic = "force-static";

const REFERRAL_CODE = "GZNNNBK5";

export function GET(): Response {
  return new Response(REFERRAL_CODE, {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
