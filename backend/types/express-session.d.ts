/* backend/types/express-session.d.ts
 *
 * Description of responsibility:
 *   Ambient module augmentation that adds a `login` field to Express's
 *   SessionData type, so `req.session.login` type-checks everywhere
 *   it's read or set across the backend.
 *
 * Info:
 *   Picked up automatically by tsc via its `.d.ts` extension — no file
 *   needs to import it directly.
 */
import "express-session";

declare module "express-session" {
  interface SessionData {
    login?: string;
  }
}
