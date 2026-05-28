import type { BrokerStatus } from "@solace-topology/shared";

export interface ClientObservation {
  brokerId: string;
  vpnName: string;
  name: string;
  username?: string;
  connected: boolean;
  ingressMsgRate: number;
  egressMsgRate: number;
  ingressByteRate: number;
  egressByteRate: number;
}

export interface QueueObservation {
  brokerId: string;
  vpnName: string;
  name: string;
  bindCount: number;
  queuedMessages: number;
  ingressMsgRate: number;
  egressMsgRate: number;
  ingressByteRate: number;
  egressByteRate: number;
}

export interface SubscriptionObservation {
  brokerId: string;
  vpnName: string;
  queueName: string;
  topic: string;
}

export interface BrokerObservation {
  brokerId: string;
  mode: "live" | "sample";
  clients: ClientObservation[];
  queues: QueueObservation[];
  subscriptions: SubscriptionObservation[];
  status: BrokerStatus;
}
