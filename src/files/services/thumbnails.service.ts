import { Logger } from '@dunx/core';
import {
  EncodableFormat,
  ImageFit,
  Images,
  type EncodedImage,
  type ImageMetadata,
} from '@dunx/infra/images';
import { AppConfigService } from '../../config/app.config.service.js';

/**
 * The two image operations this app performs: measure an upload, and render a
 * thumbnail for one.
 *
 * `ImagePipeline` is immutable - `Bun.Image` mutates and returns `this`, and the
 * pipeline returns a new value per operation - so the same loaded source can be
 * measured and re-encoded without either affecting the other.
 */
export class ThumbnailsService {
  constructor(
    private readonly images: Images,
    private readonly config: AppConfigService,
    private readonly logger: Logger,
  ) {}

  /**
   * `undefined` for anything that is not a decodable image, which is most uploads.
   * A CSV is not an error here, and neither is a truncated PNG: the row simply
   * carries no dimensions.
   */
  async dimensions(bytes: Uint8Array): Promise<ImageMetadata | undefined> {
    if (!this.images.supports(bytes)) return undefined;
    try {
      return await this.images.metadata(bytes);
    } catch (error) {
      this.logger.warn('image metadata failed', {
        reason: (error as Error).message,
      });
      return undefined;
    }
  }

  /** WebP, because it is the smallest of the three formats Bun can encode. */
  async render(bytes: Uint8Array, width?: number): Promise<EncodedImage> {
    const target = width ?? this.config.get('images').thumbnailWidth;
    const pipeline = await this.images.load(bytes);
    return pipeline
      .resize(target, undefined, {
        // `INSIDE` keeps the aspect ratio, and `withoutEnlargement` stops a 4x4
        // icon being blown up to 256 wide.
        fit: ImageFit.INSIDE,
        withoutEnlargement: true,
      })
      .to(EncodableFormat.WEBP, { quality: this.config.get('images').quality })
      .encode();
  }
}
