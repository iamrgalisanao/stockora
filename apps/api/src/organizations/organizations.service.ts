import { Injectable, NotFoundException } from '@nestjs/common';
import type { OrganizationResponse } from '@iw/contracts';
import { PrismaService } from '../prisma/prisma.service';

interface UpdateOrganizationInput {
  name?: string;
  currency?: string;
}

@Injectable()
export class OrganizationsService {
  constructor(private readonly prisma: PrismaService) {}

  async getById(organizationId: string): Promise<OrganizationResponse> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });
    if (!org) throw new NotFoundException('Organization not found');
    return this.toResponse(org);
  }

  async update(
    organizationId: string,
    input: UpdateOrganizationInput,
  ): Promise<OrganizationResponse> {
    // where scoped by id (the tenant boundary); a caller can only ever reach their own org.
    const org = await this.prisma.organization.update({
      where: { id: organizationId },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.currency !== undefined ? { currency: input.currency } : {}),
      },
    });
    return this.toResponse(org);
  }

  private toResponse(org: {
    id: string;
    name: string;
    slug: string;
    currency: string;
    status: string;
    createdAt: Date;
  }): OrganizationResponse {
    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
      currency: org.currency,
      status: org.status,
      createdAt: org.createdAt.toISOString(),
    };
  }
}
