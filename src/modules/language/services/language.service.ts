import { Injectable } from '@nestjs/common';
import { LanguageRepository } from 'modules/language/repositories';
import { InsertResult } from 'typeorm';
import { LanguageEntity } from '../entities';

@Injectable()
export class LanguageService {
  private readonly _languages = [
    { name: 'Polish', code: 'pl' },
    { name: 'English', code: 'en' },
    { name: 'German', code: 'de' },
  ];

  constructor(private readonly _languageRepository: LanguageRepository) {}

  public async getLanguages(): Promise<LanguageEntity[]> {
    const queryBuilder = this._languageRepository.createQueryBuilder(
      'language',
    );

    return queryBuilder.getMany();
  }

  public async getLanguage(uuid: string): Promise<LanguageEntity> {
    const queryBuilder = this._languageRepository.createQueryBuilder(
      'language',
    );

    queryBuilder.where('language.uuid = :uuid', { uuid });

    return queryBuilder.getOne();
  }

  public async setLanguages(): Promise<void> {
    for (const { name, code } of this._languages) {
      await this._createLanguage(name, code);
    }
  }

  private async _createLanguage(
    name: string,
    code: string,
  ): Promise<InsertResult> {
    const queryBuilder = this._languageRepository.createQueryBuilder(
      'language',
    );

    return queryBuilder
      .insert()
      .values({ name, code })
      .onConflict(
        `("name") DO UPDATE
                SET name = :name`,
      )
      .setParameter('name', name)
      .execute();
  }
}
