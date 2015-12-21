﻿using System;
using System.Collections.Generic;
using System.Linq;
using System.Linq.Expressions;
using System.Text;
using System.Threading.Tasks;
using NWheels.DataObjects;
using NWheels.Entities.Core;

namespace NWheels.Entities
{
    public interface IEntityRepository
    {
        object New();
        object New(Type concreteContract);
        object TryGetById(IEntityId id);
        IEntityId MakeEntityId(object value);
        void Save(object entity);
        void Insert(object entity);
        void Update(object entity);
        void Delete(object entity);
        EntityChangeMessage CreateChangeMessage(IEnumerable<IDomainObject> entities, EntityState state);
        Type ContractType { get; }
        Type ImplementationType { get; }
        Type PersistableObjectFactoryType { get; }
        ITypeMetadata Metadata { get; }
    }

    //---------------------------------------------------------------------------------------------------------------------------------------------------------

    public interface IEntityRepository<TEntity>// : IQueryable<TEntity>
    {
        IQueryable<TEntity> AsQueryable();
        TEntity New();
        TEntity New(Type concreteContract);
        TEntity TryGetById(IEntityId id);
        TEntity TryGetById<TId>(TId id);
        TEntity GetById(IEntityId id);
        TEntity GetById<TId>(TId id);
        IEntityId MakeEntityId(object value);
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
