const MAX_FILE_SIZE = 10 * 1024 * 1024;
const FIREBASE_SIGNING_KEYS_URL =
    'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

let signingKeys = null;
let signingKeysExpiresAt = 0;

function allowedOrigins(env) {
    return (env.ALLOWED_ORIGINS || '')
        .split(',')
        .map(origin => origin.trim())
        .filter(Boolean);
}

function corsHeaders(origin, env) {
    const headers = new Headers({ Vary: 'Origin' });
    if (origin && allowedOrigins(env).includes(origin)) {
        headers.set('Access-Control-Allow-Origin', origin);
        headers.set('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
        headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
        headers.set('Access-Control-Max-Age', '86400');
    }
    return headers;
}

function jsonResponse(request, env, data, status = 200) {
    const headers = corsHeaders(request.headers.get('Origin'), env);
    headers.set('Content-Type', 'application/json; charset=utf-8');
    headers.set('Cache-Control', 'no-store');
    return new Response(JSON.stringify(data), { status, headers });
}

function decodeBase64Url(value) {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);
    return Uint8Array.from(atob(padded), character => character.charCodeAt(0));
}

function decodeJsonPart(value) {
    return JSON.parse(new TextDecoder().decode(decodeBase64Url(value)));
}

async function loadSigningKeys(forceRefresh = false) {
    if (!forceRefresh && signingKeys && Date.now() < signingKeysExpiresAt) return signingKeys;
    const response = await fetch(FIREBASE_SIGNING_KEYS_URL);
    if (!response.ok) throw new Error('Could not load Firebase signing keys.');
    const result = await response.json();
    if (!Array.isArray(result.keys)) throw new Error('Firebase signing keys response is invalid.');
    signingKeys = result.keys;
    const maxAge = /max-age=(\d+)/i.exec(response.headers.get('Cache-Control') || '');
    const cacheSeconds = maxAge ? Math.min(Number(maxAge[1]), 3600) : 300;
    signingKeysExpiresAt = Date.now() + cacheSeconds * 1000;
    return signingKeys;
}

async function authenticateFirebaseToken(request, env) {
    const authorization = request.headers.get('Authorization') || '';
    const match = /^Bearer ([A-Za-z0-9._-]+)$/.exec(authorization);
    if (!match || match[1].length > 8192) return null;

    const parts = match[1].split('.');
    if (parts.length !== 3) return null;

    let header;
    let claims;
    try {
        header = decodeJsonPart(parts[0]);
        claims = decodeJsonPart(parts[1]);
    } catch {
        return null;
    }
    if (header.alg !== 'RS256' || typeof header.kid !== 'string') return null;

    let key = (await loadSigningKeys()).find(candidate => candidate.kid === header.kid);
    if (!key) key = (await loadSigningKeys(true)).find(candidate => candidate.kid === header.kid);
    if (!key) return null;

    let cryptoKey;
    let isSignatureValid;
    try {
        cryptoKey = await crypto.subtle.importKey(
            'jwk',
            key,
            { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
            false,
            ['verify']
        );
        isSignatureValid = await crypto.subtle.verify(
            { name: 'RSASSA-PKCS1-v1_5' },
            cryptoKey,
            decodeBase64Url(parts[2]),
            new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
        );
    } catch {
        return null;
    }
    if (!isSignatureValid) return null;

    const now = Math.floor(Date.now() / 1000);
    const projectId = env.FIREBASE_PROJECT_ID;
    if (!projectId
        || claims.aud !== projectId
        || claims.iss !== `https://securetoken.google.com/${projectId}`
        || typeof claims.sub !== 'string'
        || claims.sub.length === 0
        || claims.sub.length > 128
        || claims.firebase?.sign_in_provider !== 'password'
        || !Number.isFinite(claims.exp)
        || claims.exp <= now
        || !Number.isFinite(claims.iat)
        || claims.iat > now + 60
        || !Number.isFinite(claims.auth_time)
        || claims.auth_time > now + 60) {
        return null;
    }
    return { uid: claims.sub };
}

function isValidObjectPath(path, uid, env) {
    if (typeof path !== 'string' || path.length > 1024 || path.includes('\\')) return false;
    const prefix = `artifacts/${env.FIREBASE_PROJECT_ID}/users/${uid}/clients/`;
    if (!path.startsWith(prefix)) return false;
    const segments = path.split('/');
    return segments.every(segment =>
        segment.length > 0
        && segment !== '.'
        && segment !== '..'
        && /^[A-Za-z0-9._-]+$/.test(segment)
    );
}

function allowedContentType(value) {
    const contentType = (value || '').split(';', 1)[0].trim().toLowerCase();
    return contentType === 'application/pdf' || /^image\/[a-z0-9.+-]+$/.test(contentType)
        ? contentType
        : null;
}

async function readFileBody(request) {
    if (!request.body) return new ArrayBuffer(0);
    const reader = request.body.getReader();
    const chunks = [];
    let size = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_FILE_SIZE) {
            await reader.cancel();
            return null;
        }
        chunks.push(value);
    }
    const result = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return result.buffer;
}

async function handleRequest(request, env) {
    const origin = request.headers.get('Origin');
    const origins = allowedOrigins(env);
    if (origin && !origins.includes(origin)) {
        return jsonResponse(request, env, { error: 'Origen no autorizado.' }, 403);
    }
    if (request.method === 'OPTIONS') {
        if (!origin || !origins.includes(origin)) {
            return jsonResponse(request, env, { error: 'Origen no autorizado.' }, 403);
        }
        return new Response(null, { status: 204, headers: corsHeaders(origin, env) });
    }

    const url = new URL(request.url);
    if (url.pathname !== '/files') {
        return jsonResponse(request, env, { error: 'Ruta no encontrada.' }, 404);
    }
    if (!['GET', 'POST', 'DELETE'].includes(request.method)) {
        return jsonResponse(request, env, { error: 'Método no permitido.' }, 405);
    }
    if (!env.FILES_BUCKET || !env.FIREBASE_PROJECT_ID) {
        return jsonResponse(request, env, { error: 'El servicio de almacenamiento no está configurado.' }, 503);
    }

    const user = await authenticateFirebaseToken(request, env);
    if (!user) return jsonResponse(request, env, { error: 'La sesión no es válida. Inicie sesión nuevamente.' }, 401);

    const path = url.searchParams.get('path');
    if (!isValidObjectPath(path, user.uid, env)) {
        return jsonResponse(request, env, { error: 'La ruta no pertenece a la cuenta actual o no es válida.' }, 403);
    }

    if (request.method === 'POST') {
        const contentType = allowedContentType(request.headers.get('Content-Type'));
        if (!contentType) {
            return jsonResponse(request, env, { error: 'Solo se permiten imágenes y documentos PDF.' }, 415);
        }
        const declaredSize = Number(request.headers.get('Content-Length'));
        if (Number.isFinite(declaredSize) && declaredSize > MAX_FILE_SIZE) {
            return jsonResponse(request, env, { error: 'El archivo supera el límite de 10 MB.' }, 413);
        }
        const data = await readFileBody(request);
        if (data === null) {
            return jsonResponse(request, env, { error: 'El archivo supera el límite de 10 MB.' }, 413);
        }
        if (data.byteLength === 0) {
            return jsonResponse(request, env, { error: 'El archivo está vacío.' }, 400);
        }
        await env.FILES_BUCKET.put(path, data, {
            httpMetadata: { contentType },
            customMetadata: { ownerUid: user.uid }
        });
        return jsonResponse(request, env, { path }, 201);
    }

    if (request.method === 'GET') {
        const object = await env.FILES_BUCKET.get(path);
        if (!object) return jsonResponse(request, env, { error: 'No se encontró el archivo solicitado.' }, 404);
        const headers = corsHeaders(origin, env);
        headers.set('Content-Type', object.httpMetadata?.contentType || 'application/octet-stream');
        headers.set('Content-Length', String(object.size));
        headers.set('Cache-Control', 'private, no-store');
        headers.set('X-Content-Type-Options', 'nosniff');
        return new Response(object.body, { headers });
    }

    await env.FILES_BUCKET.delete(path);
    return jsonResponse(request, env, { deleted: true });
}

export default {
    async fetch(request, env) {
        try {
            return await handleRequest(request, env);
        } catch (error) {
            console.error('Private R2 storage request failed:', error);
            return jsonResponse(request, env, { error: 'No se pudo completar la operación de almacenamiento.' }, 500);
        }
    }
};
