import { Controller, Get, Query } from '@nestjs/common';
import { PERMISSIONS, SearchResult } from '@iw/contracts';
import { CurrentUser, RequirePermissions } from '../common/decorators';
import type { RequestUser } from '../common/request-user';
import { GlobalSearchService } from './global-search.service';

@Controller('search')
export class SearchController {
  constructor(private readonly search: GlobalSearchService) {}

  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  @Get()
  find(
    @CurrentUser() user: RequestUser,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
  ): Promise<SearchResult[]> {
    return this.search.search(user, q ?? '', limit ? Number(limit) : undefined);
  }
}
