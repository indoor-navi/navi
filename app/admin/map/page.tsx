'use client';

import AdminAuthGate from '@/components/AdminAuthGate';
import MapEditor3D from '@/components/MapEditor3D';

export default function AdminMapPage() {
  return (
    <AdminAuthGate>
      <MapEditor3D />
    </AdminAuthGate>
  );
}