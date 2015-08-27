﻿using System;
using System.Collections.Generic;
using System.Linq;
using System.Linq.Expressions;
using System.Text;
using System.Threading.Tasks;
using NWheels.DataObjects;

namespace NWheels.Entities
{
    public interface IEntityRepository
    {
        object New();
        object New(Type concreteContract);
        object TryGetById(IEntityId id);
        void Save(object entity);
        void Insert(object entity);
        void Update(object entity);
        void Delete(object entity);
        Type ContractType { get; }
        Type ImplementationType { get; }
        ITypeMetadata Metadata { get; }
    }

    //---------------------------------------------------------------------------------------------------------------------------------------------------------

    public interface IEntityRepository<TEntity> : IQueryable<TEntity>
    {
        TEntity New();
        TEntity New(Type concreteContract);
        TEntity TryGetById(IEntityId id);
        TConcreteEntity New<TConcreteEntity>() where TConcreteEntity : class, TEntity;
        IQueryable<TEntity> Include(params Expression<Func<TEntity, object>>[] properties);
        void Save(TEntity entity);
        void Insert(TEntity entity);
        void Update(TEntity entity);
        void Delete(TEntity entity);
        TEntity CheckOutOne<TState>(
            Expression<Func<TEntity, bool>> where,
            Expression<Func<TEntity, TState>> stateProperty,
            TState newStateValue);
    }
}
