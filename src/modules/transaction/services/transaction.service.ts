import { Injectable } from '@nestjs/common';
import { Order } from 'common/constants';
import { PageMetaDto } from 'common/dto';
import {
    AmountMoneyNotEnoughException,
    AttemptMakeTransferToMyselfException,
    BillNotFoundException,
    CreateFailedException,
    TransactionNotFoundException,
} from 'exceptions';
import { BillRepository } from 'modules/bill/repositories';
import { BillService } from 'modules/bill/services';
import {
    ConfirmTransactionDto,
    CreateTransactionDto,
    TransactionsPageDto,
    TransactionsPageOptionsDto,
} from 'modules/transaction/dto';
import { TransactionEntity } from 'modules/transaction/entities';
import { TransactionRepository } from 'modules/transaction/repositories';
import { UserEntity } from 'modules/user/entities';
import { UtilsService } from 'providers';
import { UpdateResult } from 'typeorm';

@Injectable()
export class TransactionService {
    constructor(
        private readonly _transactionRepository: TransactionRepository,
        private readonly _billRepository: BillRepository,
        private readonly _billService: BillService,
    ) {}

    public async getTransactions(
        user: UserEntity,
        pageOptionsDto: TransactionsPageOptionsDto,
    ): Promise<TransactionsPageDto | undefined> {
        const queryBuilder = this._transactionRepository.createQueryBuilder(
            'transactions',
        );

        const [
            transactions,
            transactionsCount,
        ] = await queryBuilder
            .leftJoinAndSelect(
                'transactions.senderAccountBill',
                'senderAccountBill',
            )
            .leftJoinAndSelect(
                'transactions.recipientAccountBill',
                'recipientAccountBill',
            )
            .leftJoinAndSelect('recipientAccountBill.user', 'recipientUser')
            .leftJoinAndSelect(
                'recipientAccountBill.currency',
                'recipientAccountBillCurrency',
            )
            .leftJoinAndSelect('senderAccountBill.user', 'senderUser')
            .leftJoinAndSelect(
                'senderAccountBill.currency',
                'senderAccountBillCurrency',
            )
            .where(':user IN ("senderUser"."id", "recipientUser"."id")')
            .andWhere('transactions.authorizationStatus = true')
            .orderBy('transactions.updatedAt', Order.DESC)
            .setParameter('user', user.id)
            .skip(pageOptionsDto.skip)
            .take(pageOptionsDto.take)
            .getManyAndCount();

        const pageMetaDto = new PageMetaDto({
            pageOptionsDto,
            itemCount: transactionsCount,
        });

        return new TransactionsPageDto(transactions.toDtos(), pageMetaDto);
    }

    public async getTransaction(
        uuid: string,
        user: UserEntity,
    ): Promise<TransactionEntity | undefined> {
        const queryBuilder = this._transactionRepository.createQueryBuilder(
            'transaction',
        );

        queryBuilder
            .leftJoin('transaction.senderAccountBill', 'senderAccountBill')
            .leftJoin('senderAccountBill.user', 'senderUser')
            .where('transaction.uuid = :uuid', { uuid })
            .andWhere('senderUser.id = :user', { user: user.id })
            .andWhere('transaction.authorizationStatus = false')
            .orderBy('transaction.id', Order.DESC);

        return queryBuilder.getOne();
    }

    public async createTransaction(
        user: UserEntity,
        createTransactionDto: CreateTransactionDto,
    ): Promise<TransactionEntity> {
        const [recipientAccountBill, senderAccountBill] = await Promise.all([
            this._billService.findBill(
                createTransactionDto.recipientAccountBill,
            ),
            this._billService.findBill(
                createTransactionDto.senderAccountBill,
                user,
            ),
        ]);

        if (!recipientAccountBill || !senderAccountBill) {
            throw new BillNotFoundException();
        }

        if (recipientAccountBill === senderAccountBill) {
            throw new AttemptMakeTransferToMyselfException();
        }

        const largerAmountMoney = UtilsService.compareNumbers(
            senderAccountBill.amountMoney,
            createTransactionDto.amountMoney,
        );

        if (
            largerAmountMoney === createTransactionDto.amountMoney ||
            createTransactionDto.amountMoney <= 0
        ) {
            throw new AmountMoneyNotEnoughException();
        }

        const authorizationKey = this._generateAuthrorizationKey();

        const transaction = this._transactionRepository.create({
            recipientAccountBill,
            senderAccountBill,
            authorizationKey,
            amountMoney: createTransactionDto.amountMoney,
            transferTitle: createTransactionDto.transferTitle,
        });

        try {
            return this._transactionRepository.save(transaction);
        } catch (error) {
            throw new CreateFailedException(error);
        }
    }

    public async confirmTransaction(
        user: UserEntity,
        confirmTransactionDto: ConfirmTransactionDto,
    ): Promise<UpdateResult> {
        const createdTransaction = await this._findTransactionByAuthorizationKey(
            confirmTransactionDto.authorizationKey,
            user,
        );

        if (!createdTransaction) {
            throw new TransactionNotFoundException();
        }

        const largerAmountMoney = UtilsService.compareNumbers(
            createdTransaction.senderAccountBill[0].amountMoney,
            createdTransaction.amountMoney,
        );

        if (largerAmountMoney === createdTransaction.amountMoney) {
            throw new AmountMoneyNotEnoughException();
        }

        return this._updateTransactionAuthorizationStatus(
            createdTransaction.senderAccountBill[0],
        );
    }

    private async _updateTransactionAuthorizationStatus(
        transaction: TransactionEntity,
    ): Promise<UpdateResult> {
        return this._transactionRepository.update(transaction.id, {
            authorizationStatus: true,
        });
    }

    private _generateAuthrorizationKey() {
        return UtilsService.generateRandomString(5);
    }

    private async _findTransactionByAuthorizationKey(
        authorizationKey: string,
        user: UserEntity,
    ): Promise<any | undefined> {
        const queryBuilder = this._billRepository.createQueryBuilder('bill');

        queryBuilder
            .addSelect(
                (subQuery) =>
                    subQuery
                        .select(
                            `COALESCE(
                                TRUNC(
                                    SUM(
                                        CASE WHEN "transactions"."recipient_account_bill_id" = "bill"."id" 
                                        THEN 1 / 
                                            CASE WHEN "senderAccountBillCurrency"."id" = "recipientAccountBillCurrency"."id" 
                                            THEN 1 
                                            ELSE 
                                                CASE WHEN "recipientAccountBillCurrency"."base" 
                                                THEN "senderAccountBillCurrency"."current_exchange_rate" :: decimal 
                                                ELSE "senderAccountBillCurrency"."current_exchange_rate" :: decimal * "recipientAccountBillCurrency"."current_exchange_rate" :: decimal 
                                                END
                                            END
                                        ELSE -1 
                                    END * "transactions"."amount_money"), 2), '0.00') :: numeric`,
                        )
                        .from(TransactionEntity, 'transactions')
                        .leftJoin(
                            'transactions.recipientAccountBill',
                            'recipientAccountBill',
                        )
                        .leftJoin(
                            'transactions.senderAccountBill',
                            'senderAccountBill',
                        )
                        .leftJoin(
                            'recipientAccountBill.currency',
                            'recipientAccountBillCurrency',
                        )
                        .leftJoin(
                            'senderAccountBill.currency',
                            'senderAccountBillCurrency',
                        )
                        .where(
                            `"bill"."id" IN ("transactions"."sender_account_bill_id", "transactions"."recipient_account_bill_id")`,
                        )
                        .andWhere('transactions.authorization_status = true'),
                'bill_amount_money',
            )
            .leftJoinAndSelect('bill.senderAccountBill', 'transaction')
            .leftJoinAndSelect('bill.currency', 'currency')
            .where('transaction.authorizationKey = :authorizationKey', {
                authorizationKey,
            })
            .andWhere('bill.user = :user', {
                user: user.id,
            })
            .andWhere('transaction.authorizationStatus = false')
            .orderBy('transaction.id', Order.DESC);

        return queryBuilder.getOne();
    }
}
