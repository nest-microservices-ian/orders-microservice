import { IsEnum, IsUUID } from 'class-validator';
import { OrderStatus } from '@prisma/client';

export class ChangeOrderStatusDto {
  @IsUUID()
  id: string;

  @IsEnum(OrderStatus)
  status: OrderStatus;
}
