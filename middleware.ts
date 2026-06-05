import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except static assets, image optimisation files,
     * and the unauthenticated webhook ingest (api/webhooks/**). Webhooks must
     * NEVER pass through the auth middleware — a redirect there returns 307 and
     * Wazzup does not follow redirects, so the message would be lost.
     */
    "/((?!api/webhooks|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
