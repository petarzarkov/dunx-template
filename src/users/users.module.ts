import { Module } from '@dunx/core';
import { UsersController } from './users.controller.js';
import { UsersRepository } from './repos/users.repository.js';
import { UsersService } from './services/users.service.js';

@Module({
  controllers: [UsersController],
  providers: [UsersService, UsersRepository],
})
export class UsersModule {}
