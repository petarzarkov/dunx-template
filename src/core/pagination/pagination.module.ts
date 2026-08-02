import { Module } from '@dunx/core';
import { PaginationFactory } from './pagination.factory.js';

@Module({ providers: [PaginationFactory] })
export class PaginationModule {}
