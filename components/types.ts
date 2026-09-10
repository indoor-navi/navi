export type AgentState = 'offline' | 'listening' | 'thinking' | 'speaking' | 'navigating';
export type AppMode = 'idle' | 'chat' | 'navigation';

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
  video: string;
  isLandmark: boolean;
  landmarkType?: string;
}

export interface ActiveQrCode {
  label: string;
  content: string;
  imageUrl: string;
}
