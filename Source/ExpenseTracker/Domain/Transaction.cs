using System;
using NWheels.Api;
using NWheels.Api.Ddd;

namespace ExpenseTracker.Domain
{
    [DomainModel.Entity(IsAggregateRoot = true)]
    public class Transaction
    {
        [DomainModel.EntityId(AutoGenerated = true)]
        public virtual Guid Id { get; }    

        //-----------------------------------------------------------------------------------------------------------------------------------------------------

        [DomainModel.PersistedValue, DomainModel.Invariant.Required]
        public virtual CategoryReference Category { get; set; }    

        //-----------------------------------------------------------------------------------------------------------------------------------------------------

        [DomainModel.PersistedValue, DomainModel.Invariant.Required]
        public virtual PayeeReference Payee { get; set; }    

        //-----------------------------------------------------------------------------------------------------------------------------------------------------

        [DomainModel.PersistedValue]
        public virtual DateTime Date { get; set; }    

        //-----------------------------------------------------------------------------------------------------------------------------------------------------

        [DomainModel.PersistedValue]
        public virtual decimal Amount { get; set; }    

        //-----------------------------------------------------------------------------------------------------------------------------------------------------

        [DomainModel.PersistedValue]
        public virtual string Memo { get; set; }

        //-----------------------------------------------------------------------------------------------------------------------------------------------------

        [DomainModel.PersistedValue]
        public virtual string ExternalReference { get; set; }
    }

    //---------------------------------------------------------------------------------------------------------------------------------------------------------

    public class TransactionReference : EntityReference<Transaction, Guid> { };
}
