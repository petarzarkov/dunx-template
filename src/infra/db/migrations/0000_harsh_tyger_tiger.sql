CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text,
	`action` text NOT NULL,
	`entity_name` text NOT NULL,
	`entity_id` text NOT NULL,
	`old_values` text,
	`new_values` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_actor_id_index` ON `audit_log` (`actor_id`);--> statement-breakpoint
CREATE INDEX `audit_action_index` ON `audit_log` (`action`);--> statement-breakpoint
CREATE INDEX `audit_entity_name_index` ON `audit_log` (`entity_name`);--> statement-breakpoint
CREATE INDEX `audit_entity_id_index` ON `audit_log` (`entity_id`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`role` text DEFAULT 'user' NOT NULL,
	`banned` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `UQ_user_email` ON `user` (`email`);