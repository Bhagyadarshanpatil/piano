import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const targetUrl = searchParams.get('url');

  if (!targetUrl) {
    return new NextResponse('Missing URL parameter', { status: 400 });
  }

  try {
    const res = await fetch(targetUrl);
    if (!res.ok) {
      return new NextResponse(`Failed to fetch from target: ${res.statusText}`, { status: res.status });
    }

    const arrayBuffer = await res.arrayBuffer();
    
    return new NextResponse(arrayBuffer, {
      headers: {
        'Content-Type': 'audio/midi',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    console.error('Proxy error:', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}
