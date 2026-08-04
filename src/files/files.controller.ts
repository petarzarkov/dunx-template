import { Controller, Delete, Get, Post, Roles, type Input } from '@dunx/http';
import { ApiDoc } from '@dunx/openapi';
import { CurrentUser } from '../auth/services/current-user.service.js';
import { Throttle } from '../core/decorators/throttle.decorator.js';
import { UserRole } from '../users/schema/user.schema.js';
import type { Page } from '@dunx/infra/pagination';
import {
  linkFile,
  listFiles,
  oneFile,
  uploadFile,
  type FileMetadata,
} from './dto/file.dto.js';
import { FilesService } from './services/files.service.js';

/**
 * Upload, list, download and delete, over whichever `Storage` backend is
 * configured. Nothing here knows which: it injects `FilesService`, which injects
 * the abstract `Storage`, so a directory and a bucket are the same code path.
 *
 * The NestJS template guarded uploads with a `MultipartFormDataGuard` because the
 * interceptor would otherwise read a JSON body as an empty file list. dunx parses
 * by content type and answers 415 itself when the declared body cannot be parsed,
 * so there is nothing to guard.
 */
@ApiDoc({
  tags: ['files'],
  description: 'Object storage: Bun.file on disk, or Bun.S3Client in a bucket.',
})
@Controller('files')
export class FilesController {
  constructor(
    private readonly files: FilesService,
    private readonly caller: CurrentUser,
  ) {}

  @ApiDoc({ tags: ['files'], summary: 'List uploaded objects' })
  @Roles(UserRole.ADMIN, UserRole.USER)
  @Get('/', listFiles)
  list(input: Input<typeof listFiles>): Promise<Page<FileMetadata>> {
    const caller = this.caller.require();
    // A non-admin sees only its own, and asking for `mine` is how an admin
    // narrows to the same view.
    const scoped =
      input.query.mine === true || !this.caller.isAdmin()
        ? { userId: caller.id }
        : {};
    return this.files.list({ ...input.query, ...scoped });
  }

  @ApiDoc({
    tags: ['files'],
    summary: 'Upload one object, multipart/form-data',
  })
  @Roles(UserRole.ADMIN, UserRole.USER)
  // Uploads are the one route worth limiting harder than the global default: they
  // decode bytes and hit storage. The decorator overrides the config, per route.
  @Throttle({ limit: 20, windowSeconds: 60 })
  @Post('/', uploadFile)
  upload(input: Input<typeof uploadFile>): Promise<FileMetadata> {
    return this.files.upload(this.caller.require().id, input.body);
  }

  @ApiDoc({ tags: ['files'], summary: 'One object, without its bytes' })
  @Roles(UserRole.ADMIN, UserRole.USER)
  @Get('/:fileId', oneFile)
  one(input: Input<typeof oneFile>): FileMetadata {
    return this.files.metadata(input.params.fileId);
  }

  /**
   * Returns a `Response` rather than an object, which is the escape hatch for
   * anything that is not JSON - here a stream, so a file larger than memory
   * transfers a chunk at a time.
   */
  @ApiDoc({ tags: ['files'], summary: 'Stream the bytes back' })
  @Roles(UserRole.ADMIN, UserRole.USER)
  @Get('/:fileId/download', oneFile)
  download(input: Input<typeof oneFile>): Promise<Response> {
    return this.files.download(input.params.fileId);
  }

  @ApiDoc({
    tags: ['files'],
    summary: 'A presigned URL, on backends that can sign one',
  })
  @Roles(UserRole.ADMIN, UserRole.USER)
  @Get('/:fileId/link', linkFile)
  link(input: Input<typeof linkFile>): { url: string; expiresIn: number } {
    return this.files.link(input.params.fileId, input.query.expiresIn);
  }

  @ApiDoc({ tags: ['files'], summary: 'Delete the object and its row' })
  @Roles(UserRole.ADMIN)
  @Delete('/:fileId', oneFile)
  remove(input: Input<typeof oneFile>): Promise<void> {
    return this.files.remove(input.params.fileId);
  }
}
