import { NextResponse } from 'next/server';
import { SESSION_COOKIE, verifySessionToken } from './lib/auth';

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

const PUBLIC_PATHS = ['/login', '/api/auth/login', '/api/auth/context', '/api/auth/bootstrap'];

export async function middleware(request) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname === p)) {
    return NextResponse.next();
  }

  // Rota de prévia de proposta: não tem cookie de sessão (quem busca pode
  // ser o servidor da Microsoft renderizando um .docx), mas tem seu próprio
  // token assinado de curta duração checado dentro da rota — ver
  // app/api/proposal-file/[assetId]/route.js.
  if (pathname.startsWith('/api/proposal-file/')) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const valid = await verifySessionToken(token);

  if (!valid) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
    }
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}
