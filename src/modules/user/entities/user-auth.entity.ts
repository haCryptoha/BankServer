import { RoleType } from 'common/constants';
import { AbstractEntity } from 'common/entities';
import { UserAuthDto } from 'modules/user/dto';
import { PasswordTransformer } from 'modules/user/transformers';
import {
    Column,
    Entity,
    JoinColumn,
    OneToOne,
    UpdateDateColumn,
} from 'typeorm';

import { UserEntity } from './user.entity';

@Entity({ name: 'users_auth' })
export class UserAuthEntity extends AbstractEntity<UserAuthDto> {
    @Column({ type: 'enum', enum: RoleType, default: RoleType.USER })
    role: RoleType;

    @Column()
    pinCode: number;

    @Column({ transformer: new PasswordTransformer() })
    password: string;

    @Column()
    lastSuccessfulLoggedDate: Date;

    @Column()
    lastFailedLoggedDate: Date;

    @UpdateDateColumn({
        type: 'timestamp with time zone',
        nullable: true,
    })
    updatedAt: Date;

    @OneToOne(() => UserEntity, (user: UserEntity) => user.userAuth, {
        cascade: true,
        eager: true,
        nullable: false,
    })
    @JoinColumn()
    user: UserEntity;

    dtoClass = UserAuthDto;
}
