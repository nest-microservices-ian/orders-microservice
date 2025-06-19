import {
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ClientProxy, RpcException } from '@nestjs/microservices';
import { PrismaClient } from '@prisma/client';
import { CreateOrderDto } from './dtos/create-order.dto';
import { OrderPaginationDto } from './dtos/order-pagination.dto';
import { ChangeOrderStatusDto } from './dtos/change-order-status.dto';
import { PRODUCT_SERVICE } from 'src/config/services';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class OrdersService extends PrismaClient implements OnModuleInit {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @Inject(PRODUCT_SERVICE)
    private readonly productsClient: ClientProxy,
  ) {
    super();
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Connected to the database');
  }

  async create(createOrderDto: CreateOrderDto) {
    try {
      const productIds = createOrderDto.items.map((item) => item.productId);
      const products = await firstValueFrom(
        this.productsClient.send({ cmd: 'validate_products' }, productIds),
      );

      const totalAmount = createOrderDto.items.reduce((acc, item) => {
        const product = products.find((p) => p.id === item.productId);
        if (!product) {
          throw new RpcException({
            status: HttpStatus.BAD_REQUEST,
            message: `Product with id ${item.productId} not found`,
          });
        }
        return acc + item.quantity * product.price;
      }, 0);

      const totalItems = createOrderDto.items.reduce(
        (acc, item) => acc + item.quantity,
        0,
      );

      const order = await this.order.create({
        data: {
          totalAmount,
          totalItems,
          items: {
            createMany: {
              data: createOrderDto.items.map((item) => ({
                productId: item.productId,
                quantity: item.quantity,
                price:
                  products.find((p) => p.id === item.productId).price ||
                  item.price,
              })),
            },
          },
        },
        include: {
          items: {
            select: {
              productId: true,
              quantity: true,
              price: true,
            },
          },
        },
      });

      return {
        ...order,
        items: order.items.map((item) => ({
          ...item,
          name: products.find((p) => p.id === item.productId).name,
        })),
      };
    } catch (error) {
      this.logger.error('Error validating products', error);
      throw new RpcException({
        status: HttpStatus.BAD_REQUEST,
        message: 'Error validating products',
      });
    }
  }

  async findAll(orderPaginationDto: OrderPaginationDto) {
    const { page, limit, status } = orderPaginationDto;

    const total = await this.order.count({
      where: {
        status: status,
      },
    });

    const data = await this.order.findMany({
      where: {
        status: status,
      },
      skip: (page - 1) * limit,
      take: limit,
    });

    const totalPages = Math.ceil(total / limit);

    return {
      data,
      meta: {
        total,
        page,
        totalPages,
      },
    };
  }

  async findOne(id: string) {
    const order = await this.order.findFirst({
      where: {
        id,
      },
      include: {
        items: {
          select: {
            productId: true,
            quantity: true,
            price: true,
          },
        },
      },
    });

    if (!order) {
      throw new RpcException({
        status: HttpStatus.NOT_FOUND,
        message: `Order with id ${id} not found`,
      });
    }

    const productIds = order.items.map((item) => item.productId);
    const products = await firstValueFrom(
      this.productsClient.send({ cmd: 'validate_products' }, productIds),
    );

    return {
      ...order,
      items: order.items.map((item) => ({
        ...item,
        name: products.find((p) => p.id === item.productId).name,
      })),
    };
  }

  async changeOrderStatus(changeOrderStatus: ChangeOrderStatusDto) {
    const { id, status } = changeOrderStatus;

    const order = await this.order.update({
      where: {
        id,
      },
      data: {
        status,
      },
    });

    if (!order) {
      throw new RpcException({
        status: HttpStatus.NOT_FOUND,
        message: `Order with id ${id} not found`,
      });
    }

    return order;
  }
}
