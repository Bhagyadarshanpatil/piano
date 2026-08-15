import { headers } from 'next/headers';
import ClientWrapper from "../ClientWrapper";
import MobileWrapper from "../MobileWrapper";

export default async function VisualizerPage() {
  const headersList = await headers();
  const userAgent = headersList.get('user-agent') || '';
  
  // Basic mobile detection regex
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent);

  return isMobile ? <MobileWrapper /> : <ClientWrapper />;
}
