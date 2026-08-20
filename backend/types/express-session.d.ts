/* backend/types/express-session.d.ts
 *
 * Description of responsibility:
 *   Ambient module augmentation that adds `login`/`userId` fields to
 *   Express's SessionData type, so `req.session.login`/`req.session.userId`
 *   type-check everywhere they're read or set across the backend.
 *
 * Info:
 *   Picked up automatically by tsc via its `.d.ts` extension — no file
 *   needs to import it directly. userId is GitHub's immutable numeric id
 *   (see authRoutes.ts's token storage) — every route still identifies
 *   "who is making this request" via login, since GitHub's own repo/fork/
 *   PR API paths need the current username regardless; userId is carried
 *   alongside it for any future check that specifically needs a durable
 *   identity rather than the current (renameable) handle.
 */
import "express-session";

declare module "express-session" {
  interface SessionData {
    login?: string;
    userId?: number;
  }
}
