/**
 * Every queue name, job name, socket topic and socket event in one file, because
 * three processes have to agree on all of them: the web app publishes, the worker
 * consumes, and a browser subscribes.
 */
export const QUEUES = Object.freeze({
  /** User-facing side effects: emails, socket notifications. */
  NOTIFICATIONS: 'notifications',
  /** Anything that touches bytes. Its own queue so it can get its own worker. */
  MEDIA: 'media',
} as const);
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export const JOBS = Object.freeze({
  USER_REGISTERED: 'user.registered',
  USER_BANNED: 'user.banned',
  FILE_THUMBNAIL: 'file.thumbnail',
} as const);
export type JobName = (typeof JOBS)[keyof typeof JOBS];

/**
 * Bun's own pub/sub topics. A topic lives in the runtime rather than in a
 * JavaScript map, and with a relay configured it is fanned out across processes as
 * well.
 */
export const TOPICS = Object.freeze({
  ADMINS: 'admins',
  CHAT: 'chat',
} as const);

export const userTopic = (userId: string): string => `user_${userId}`;

/** What the server sends. The envelope on the wire is `{"event":..,"data":..}`. */
export const EVENTS = Object.freeze({
  CONNECTED: 'connected',
  NOTIFICATION: 'notification',
  MESSAGE: 'message',
  USER_COUNT: 'userCount',
} as const);

/** What a client sends. */
export const CLIENT_EVENTS = Object.freeze({
  CHAT_MESSAGE: 'chatMessage',
} as const);

export interface UserRegisteredJob {
  readonly userId: string;
  readonly email: string;
  readonly name: string;
}

export interface UserBannedJob {
  readonly userId: string;
  readonly email: string;
  readonly reason: string;
}

export interface FileThumbnailJob {
  readonly fileId: string;
  readonly key: string;
  readonly width: number;
}

export interface Notification {
  readonly event: JobName;
  readonly payload: Record<string, unknown>;
}
