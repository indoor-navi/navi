import type { Doc } from '@/convex/_generated/dataModel';

export type AgentState = 'offline' | 'listening' | 'thinking' | 'speaking' | 'navigating';
export type AppMode = 'idle' | 'chat' | 'navigation';

export interface BuildingContext {
  destinations: Array<Pick<Doc<'destinations'>, '_id' | 'name' | 'aliases' | 'floorId' | 'description'>>;
  floors: Array<Pick<Doc<'floors'>, '_id' | 'name' | 'level'>>;
  nodes: Array<Pick<Doc<'nodes'>, '_id' | 'label' | 'floorId' | 'isLandmark' | 'landmarkType'>>;
  qrCodes: Doc<'qrCodes'>[];
  assistantConfig: Doc<'assistantConfig'> | null;
  assistantLogoUrl: string | null;
  totalNodes: number;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface SlideData {
  id: string;
  stepTitle: string;
  originNodeLabel: string;
  targetNodeLabel: string;
  textDirection: string;
  description: string;
  walkingTime: number;
  isLandmark: boolean;
  landmarkType?: string;
}

export interface ActiveQrCode {
  label: string;
  content: string;
  imageUrl: string;
}
